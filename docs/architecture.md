# Architecture and design notes

Rationale for how this app is built, plus the non-obvious invariants that are easy to break. For setup and usage, see the [README](../README.md).

## Layout

```
app/                  Next.js App Router
  api/                route handlers (all nodejs runtime, force-dynamic)
  page.tsx            renders <ReaderApp>, reports whether Neon is active
  globals.css         theme tokens + @utility classes + article typography
components/           client UI (ReaderApp orchestrates; the rest are presentational)
lib/                  server logic
  db.ts               driver selection (Neon vs PGlite) + auto-migration
  schema.ts           Drizzle schema
  migrate.mjs         migration runner and SQL statement splitter
  refresh.ts          feed refresh orchestration
  feeds.ts            batched upserts and feed queries
  taxonomy.ts         folders and tags
  articles.ts         article read model
  parser.ts           feed parsing + HTML sanitization
  extract.ts          Readability full-text extraction
  http.ts             conditional GET, retries, URL normalization
  urlSafety.mjs       SSRF host blocklist
  auth.ts             session cookies (Web Crypto, edge-safe)
proxy.ts              auth gate + security headers (Next 16 renamed middleware)
drizzle/              SQL migrations + drizzle-kit journal/snapshots
scripts/              migration runner, diagnostics, tests
```

## Migrations

Four migrations, two of them hand-written:

| File | Contents | Why hand-written |
|---|---|---|
| `0000_numerous_ikaris.sql` | `feeds`, `articles`, indexes, `(feed_id, guid)` unique constraint | generated |
| `0001_full_text_search.sql` | `search_vector` tsvector column, GIN index, trigger | drizzle-kit cannot express `tsvector` or GIN |
| `0002_folders_and_tags.sql` | `folders`, `tags`, `feed_tags`, `feeds.folder_id` | generated |
| `0003_article_extraction.sql` | `extracted_content`, `extracted_at`, `extracted_byline`, `extraction_error` | `ALTER TABLE ADD COLUMN` has no `IF NOT EXISTS` |

**Invariants to preserve:**

- Hand-written migrations must be **idempotent**. The runner records completed files in `__migrations`, but a file that fails halfway is replayed from the top on the next run, so every statement must tolerate existing state. `0003` uses guarded `DO` blocks for this reason.
- The drizzle-kit **journal and snapshots were reconciled by hand** to include the hand-written files so numbering stays correct. `drizzle-kit generate` reports no drift. If you regenerate from scratch, keep these files separate and re-apply the same journal edits.
- `alter table` statements are split individually for the Neon HTTP driver, which runs **one statement per call**. `lib/migrate.mjs` contains a hand-written splitter that understands dollar-quoted `DO $$` bodies and comments; `npm run test:splitter` asserts it never loses or cuts a statement.

Migrations apply automatically on first request (`lib/db.ts`), so a fresh deploy needs no manual step.

## Ingestion (`lib/refresh.ts`, `lib/feeds.ts`, `lib/http.ts`)

- **Batched upserts.** Articles are inserted in batches of 200 as one multi-row statement. A 50-feed refresh is ~10 queries rather than thousands. `ON CONFLICT (feed_id, guid) DO UPDATE` refreshes mutable fields while **deliberately preserving `is_read`**, so re-fetching never resurrects read articles as unread. `RETURNING (xmax = 0)` distinguishes inserts from updates for accurate reporting.
- **Conditional GET.** `ETag`/`Last-Modified` are stored per feed and replayed; a 304 costs no parse and no write. Conditional headers are sent **only after a feed has been ingested once** — otherwise a feed whose own `Last-Modified` is newer than the moment it was added would 304 on the ingestion pass and its backlog would never import. This was a real bug: feeds returned `added: 0` forever.
- **Bounded concurrency and a time budget.** 5 feeds at a time with a 50s budget, so one slow feed cannot blow the function limit. Feeds not reached are reported as `skipped`.
- **Transient-failure retries are opt-in.** `fetchFeedDocument` defaults to one attempt. The interactive add-feed path requests 3 (a user is waiting; hosts intermittently 5xx or reset). The bulk refresh keeps one attempt so a dead host is not retried 50 times. Only connection errors, timeouts, and 408/425/429/5xx are retried — never a 404 or parse failure.
- **Per-feed error state.** Failures record `last_error`/`last_error_at` and increment `error_count`; the UI surfaces a warning marker. `last_fetched_at` is only set on success.

## Folders and tags (`lib/taxonomy.ts`)

- **One level of nesting** (`folders.parent_id`). A folder's unread count **rolls up its subfolders**, so collapsing still shows everything unread inside. Sibling uniqueness is enforced by an index on `(coalesce(parent_id, 0), name)`.
- **Deleting a folder never deletes content.** Feeds are promoted to the parent (or top level) and articles are kept, so the app does not rely solely on the `ON DELETE SET NULL` safety net; subfolders cascade.
- **Tags are cross-cutting** (`tags` + `feed_tags`), filterable independently of the folder tree. Assignment is idempotent via the composite PK, and tags attached to nothing are pruned so the filter strip does not accumulate orphans.
- **Renaming a tag onto an existing name merges** them and reports `merged: true` so the client drops a now-invalid selection.
- **Duplicate folder names return 409** via an explicit pre-check, with SQLSTATE `23505` detection through Drizzle's `cause` chain as a backstop for the check/insert race.

## Full-text extraction (`lib/extract.ts`)

- **Detection.** An article is a teaser when its feed body is under 400 characters of text. Those extract automatically on open — once per open, so a failure cannot loop.
- **Readability over linkedom.** `@mozilla/readability` needs a DOM; linkedom supplies one without a browser, keeping the route on the Node runtime and bundle-friendly.
- **Sanitized twice** (in the pipeline and again on write) so there is a single choke point for anything rendered with `dangerouslySetInnerHTML`.
- **Failures never destroy good data.** A failed re-extraction records `extraction_error` but leaves any existing extracted body intact.
- **Caching is just the column.** A repeat request short-circuits on `extracted_content` (~15 ms) rather than refetching.
- Verified end to end: a BBC article goes from a 121-character teaser to ~2,650 characters plus byline.

## Security

- **Auth.** `proxy.ts` (Next 16's renamed middleware) gates every route except `/login`, `/api/auth/*`, and `/api/cron/*`. Sessions are HMAC-SHA256 signed, expiring cookies compared in **constant time**. Changing `APP_PASSWORD` or `SESSION_SECRET` invalidates all sessions. Web Crypto is used rather than `node:crypto` so the module also works under the edge runtime.
- **Cron.** `/api/cron/refresh` requires `Authorization: Bearer $CRON_SECRET` and **fails closed** when the secret is unset. It is exempt from the cookie gate because Vercel Cron cannot send cookies.
- **Feed HTML is untrusted.** Bodies are sanitized server-side before storage: scripts, iframes, event handlers, and `javascript:` URLs are stripped, and links are rewritten with `rel="noopener noreferrer nofollow"`. The reader's `dangerouslySetInnerHTML` is only safe because of this step.
- **SSRF posture.** Feed fetching follows redirects and will request whatever URL is submitted. Extraction adds a hostname blocklist (`lib/urlSafety.mjs`) covering loopback, private, link-local, and cloud-metadata addresses, plus non-http schemes. This is defence in depth, **not** complete: a public hostname that resolves to a private address is not caught. Keep the app behind the password gate and do not expose the add-feed or extract endpoints to untrusted users.
- **CORS/CSRF.** State-changing routes are same-origin and cookie-authenticated (`SameSite=Lax`); login additionally rejects cross-origin `Origin` headers.

## Rendering and theming

- All API routes are `runtime = 'nodejs'` (the parser needs Node built-ins; Edge would fail) and `dynamic = 'force-dynamic'` so nothing is prerendered into a stale snapshot.
- **Themes** are driven by `data-theme` on `<html>`, set by an inline script **before first paint** so there is no flash of the wrong palette. Palettes are CSS custom properties (`--app-*`) consumed through `@utility` classes (`app-panel`, `app-text-muted`, …) so Tailwind variants like `hover:app-muted` and `dark:app-active` still work.
- **Sepia is the default.** A stored `light` from an older build is migrated to sepia **once** (flagged by `rss-theme-migrated-sepia`), because older versions followed the OS preference without storing it — so a stored `light` is usually that implicit default, not a deliberate pick. After the migration, an explicit choice always sticks, and `dark` is never migrated.
- **Reader text size is applied as inline CSS custom properties** (`--reader-size`, `--reader-leading`), not utility classes. An earlier version used `text-[1.2rem]`; Tailwind emitted `.article-body{font-size:.95rem}` *after* those utilities at equal specificity, so the rule won and every size rendered identically. Inline custom properties cannot lose that fight. `pre`/`code`/`table` inside articles size in `em` so they scale too.

## Testing

| Command | Covers | Needs |
|---|---|---|
| `npm test` | typecheck, SQL splitter, HTTP retry/URL logic | nothing |
| `npm run test:e2e` | full API surface | running server |
| `npm run test:e2e` + `E2E_EXTRACTION=1` | live extraction against a real news site | network |

The unit tests deliberately target the two areas where mistakes are silent and destructive: the SQL splitter (a bug would corrupt a real database) and HTTP transcript handling (a bug produces confusing intermittent 422s). The e2e suite is idempotent and seeds its own feeds, so it runs against an empty or populated database — including Neon.

## Debugging notes

- **Stale `.next` causes phantom 404s.** `next dev` caches discovered routes in `.next/dev/server/app-paths-manifest.json`. A dev server left running holds that manifest; deleting `.next` out from under it makes things worse. Stop all servers, `npm run clean`, restart.
- **PGlite is single-process.** It is a WASM Postgres with a file lock; a second process opening `./.pglite-data` aborts with `RuntimeError: Aborted()`. A running server also holds its own in-memory copy, so **restart it after migrating**.
- **`db:check` never mutates.** It deliberately does not import `lib/db.ts`, because that runs migrations as a side effect; a diagnostic should not change what it inspects.
