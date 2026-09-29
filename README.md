# RSS Reader

A single-user RSS reader built to `rss-reader-spec.md`: Next.js (App Router) + Neon Postgres + Vercel Cron, with a password gate.

## What it does

- Add feeds by URL, or paste any site URL and the feed link is autodiscovered from the page's `<link rel="alternate">`.
- Fetch on demand (Refresh button, per-feed or all feeds) and a daily schedule via Vercel Cron.
- **Distraction-free reader**: click an article (or its Read button) and the sidebar, list, header, and search box are all replaced by a clean full-screen reading view — serif body text, adjustable size, reading-progress bar. "Read from source" opens the original at any point.
- **Full-text extraction**: feeds that only publish a teaser (BBC, Hacker News) get their article body pulled from the source page automatically.
- **Folders** group feeds in a collapsible tree (one level of nesting) with rolled-up unread counts; **tags** are cross-cutting labels you can filter by across folders.
- Mark read/unread, mark everything in a feed as read, open the original.
- Full-text search across titles and article bodies (Postgres `tsvector` + GIN index).
- OPML import/export.
- **Three themes** — a warm off-white light mode (not pure white), a sepia eye-protection reading mode (the default), and dark — plus unread-count badges and pagination.

## Quick start

```bash
npm install
cp .env.example .env.local     # optional for local dev, see below
npm run dev
```

Open http://localhost:3000.

**With no `DATABASE_URL` set, the app runs on embedded PGlite** (a real Postgres compiled to WASM) stored in `./.pglite-data`. That means you can run and evaluate it with no cloud account and no configuration at all. The UI shows a banner in this mode. Set `DATABASE_URL` to a Neon connection string and it switches to Neon with no code change.

> **PGlite is single-process only.** Do not point two servers (for example `next dev` and `next start`) at the same `./.pglite-data` directory at once — PGlite is a WASM Postgres with a file lock, and the second process aborts with `RuntimeError: Aborted()`. Neon has no such restriction; this only affects the local fallback.

### Reader mode

Clicking an article title opens the reader as a full-viewport layer, so the list, sidebar, search box, and badges are genuinely gone rather than visually toned down. Keyboard shortcuts:

| Key | Action |
|---|---|
| `Esc` | Close the reader |
| `m` | Toggle read/unread |
| `o` | Open the original at the source |
| `f` | Fetch the full text from the source (re-fetches with the full text already loaded) |
| `s` | Cycle text size (small / medium / large) |

Text size persists in `localStorage`. A "Read from source" button also sits at the end of every article, and each list row has a **Source ↗** action for reading without opening the reader first. Opening an article marks it read (the same convention most readers use); the checkbox and `m` let you undo that.

### Themes

Three themes, cycled by the header button (light → sepia → dark) and applied via `data-theme` on `<html>` before first paint, so there is no flash of the wrong palette.

**Sepia is the default.** A first launch (or cleared storage) gets sepia, and the choice persists across launches.

| Theme | Background | Notes |
|---|---|---|
| Light | `#f6f5f1` | Warm off-white, **not** pure white — a #fff page next to a dark sidebar is harsh over long sessions. |
| **Sepia (default)** | `#f2e9d8` | Eye-protection reading mode. Light-mode only by design: a warm paper tone for low-glare reading, which is what you want instead of dark, not instead of light. |
| Dark | `#0c0c0d` | Neutral dark, unaffected by sepia. |

An explicit choice always wins and survives relaunch. One exception, by design: a stored `light` from an older build is migrated to sepia **once** (`rss-theme-migrated-sepia` in `localStorage`). Earlier versions followed the OS preference without storing it, so a stored `light` is usually that old implicit default rather than a deliberate pick. After the one-time migration, choosing light explicitly sticks. Dark is never migrated.

All three clear WCAG AA for body text (contrast ratios: light 14.6:1, sepia 10.2:1, dark 16.7:1; muted text 5.2/4.8/7.6:1). The palette is driven by CSS custom properties (`--app-bg`, `--app-panel`, `--app-text`, … in `app/globals.css`) and consumed through `@utility` classes (`app-panel`, `app-text-muted`, …) so Tailwind variants such as `hover:app-muted` and `dark:app-active` still work.

### Text size

Reader text sizes are `1rem` / `1.125rem` / `1.3rem`. They are applied as **inline CSS custom properties** (`--reader-size`, `--reader-leading`) rather than utility classes, because an earlier version used arbitrary-value classes like `text-[1.2rem]` and Tailwind emitted `.article-body{font-size:.95rem}` *after* those utilities at equal specificity — so the rule won and every size looked identical. Inline custom properties cannot lose that fight. `pre`/`code`/`table` inside articles size in `em`, so they scale with the setting.

### Full-text extraction

Many feeds publish only a one-line teaser instead of the article — BBC News and Hacker News both do (`content:encoded` is simply absent). The reader detects this by length and fetches the article page itself, extracting the body with [Mozilla Readability](https://github.com/mozilla/readability):

- Extraction runs automatically for articles whose feed body is under 400 characters (toggleable in the reader's ⚙ settings), and can be triggered manually at any time with **Load full text** or `f`.
- The result is stored on the article (`extracted_content`, `extracted_byline`), so re-opening is instant and works offline afterwards. "Refresh" re-fetches.
- Extracted HTML goes through the **same sanitizer** as feed HTML before storage, and the raw feed content is left untouched.
- Failures are recorded on the row (`extraction_error`) and shown in the reader with a retry and a "Read from source" fallback, rather than silently rendering a teaser as if it were the whole article.
- Paywalled or script-rendered pages will legitimately fail. Set `PROXY_BASE_URL` to a fetch proxy if a site blocks your server's IP.

Verified end to end: the BBC article *"Warning more homes will be uninsurable due to flood risk"* goes from a **121-character teaser to 2,650 characters** of article text plus byline.

**SSRF note.** Extraction fetches a URL derived from feed content, so `lib/urlSafety.mjs` blocks loopback, private, link-local, and cloud-metadata addresses before any request is made. This is defence in depth, not a complete SSRF solution — a public hostname that resolves to a private address is not caught. Keep the extract endpoint behind the password gate and do not expose it to untrusted users.



### Optional local password

Set `APP_PASSWORD` in `.env.local` to enable the login gate. If it is unset the app is **completely open** — anyone who can reach the URL can add and delete feeds. Always set it before deploying.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Production | Neon **pooled** connection string. Falls back to local PGlite when unset. |
| `APP_PASSWORD` | Strongly recommended | Enables the single-user login gate. Unset = no auth. |
| `SESSION_SECRET` | Recommended | Signs the session cookie. Defaults to `APP_PASSWORD`. |
| `CRON_SECRET` | For cron | Required by `/api/cron/refresh`. Vercel sends it automatically. |
| `PGLITE_DATA_DIR` | No | Overrides where the local PGlite database lives. |
| `PROXY_BASE_URL` | No | Fetch proxy for full-text extraction. The target URL is appended to it, so `https://proxy.example.com/` requests `https://proxy.example.com/https://www.bbc.co.uk/...`. Needed when a source site blocks serverless egress IPs. |
| `PROXY_SECRET` | No | Sent as `x-proxy-secret` on extraction requests when a proxy is configured. |

## Database

Schema and migrations are versioned in `drizzle/`. The app uses **Neon** when `DATABASE_URL` is set and **embedded PGlite** (`./.pglite-data`) when it is not — see [Setting up Neon](#setting-up-neon).

```bash
npm run db:generate      # after editing lib/schema.ts
npm run db:check         # read-only: verify connection + schema (no mutation)
npm run db:migrate       # apply to Neon (uses DATABASE_URL from .env.local)
npm run db:migrate:local # apply to the local PGlite database
npm run db:reset:local   # wipe the local PGlite database and re-apply migrations
```

Migrations are also applied automatically on first use, so a fresh deploy needs no manual step. Four migrations exist:

- `0000_*.sql` — tables, indexes, and the `(feed_id, guid)` unique constraint that makes article upserts idempotent.
- `0001_full_text_search.sql` — the `search_vector` tsvector column, its GIN index, and a trigger. Hand-written because drizzle-kit cannot express `tsvector` or GIN indexes.
- `0002_folders_and_tags.sql` — the `folders`, `tags`, and `feed_tags` tables plus `feeds.folder_id`.
- `0003_article_extraction.sql` — `extracted_content`, `extracted_at`, `extracted_byline`, and `extraction_error` on `articles`. Hand-written as guarded `DO` blocks because `ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS` form.

> `0001` and `0003` are hand-written and therefore do not come from `drizzle-kit generate`. The journal and snapshots were reconciled by hand so drizzle-kit keeps numbering correctly; `drizzle-kit generate` reports no drift. If you regenerate migrations from scratch, keep these SQL files separate and re-apply the same journal edits.

## Setting up Neon

The app switches from the local PGlite fallback to Neon purely on the presence of `DATABASE_URL` (`lib/db.ts:25`). No code change is needed.

### 1. Create the project

Sign in at [console.neon.tech](https://console.neon.tech) → **New Project**. Choose a region near you; the default `production` branch and `neondb` database are fine.

### 2. Copy the pooled connection string

Open **Connect** and make sure the **Pooled connection** toggle is on — the host must contain `-pooler`. The pooled endpoint is what you want for serverless, where many short-lived connections are opened.

### 3. Put it in `.env.local`

```bash
cp .env.example .env.local
# then edit .env.local
```

```ini
DATABASE_URL=postgresql://USER:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require
APP_PASSWORD=            # set this before exposing the app
SESSION_SECRET=          # any long random string
CRON_SECRET=             # any long random string; needed for Vercel Cron
```

`.env.local` is gitignored. `.env.example` is the tracked template — never put real credentials in it.

### 4. Apply migrations and verify

```bash
npm run db:migrate   # applies all four migrations
npm run db:check     # read-only: connection, migrations, tables, tsvector column
npm run dev
```

`db:migrate` should print `Neon: applied 4 migration(s)`. Running it again prints `already up to date` — migrations are tracked in `__migrations` and are idempotent, so they are also safe to leave to the app, which applies them automatically on first use (`lib/db.ts:32`).

`db:check` exits non-zero if anything is wrong and will warn if the host is not pooled or `sslmode` is missing.

### Notes

- **Free tier scales to zero.** The first request after a period of inactivity takes a few seconds to wake the compute. That is expected, not a timeout.
- **`sslmode=require` is required** (Neon appends it). The driver refuses plaintext.
- **Unset `DATABASE_URL` and the app silently falls back to PGlite.** `npm run db:check` always prints which backend is active. The in-app banner appears only in the PGlite case.
- **The PGlite file-lock problem disappears** with Neon, since there is no local data directory.
- **The Neon CLI is optional.** `neon config init` / `neon deploy` / `neon.ts` belong to the **Neon Functions config pack** (branch policy, functions, buckets) and are unrelated to this app. If you prefer the CLI for the connection string:

  ```bash
  npx neonctl auth                            # browser, or set NEON_API_KEY
  npx neonctl link --project-id <id> --branch production -y
  npx neonctl connection-string --pooled      # -> DATABASE_URL
  ```

  `neon auth` cannot run headlessly; use an API key for scripts and CI.

## Deploying to Vercel

1. Create the Neon project and copy the **pooled** connection string (above).
2. Import the repo into Vercel and set `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`, and `CRON_SECRET`.
3. Deploy. The cron entry in `vercel.json` runs `/api/cron/refresh` once daily at 07:00 UTC.

**Hobby plan cron limitation:** Vercel restricts Hobby accounts to jobs that run **at most once per day**. A twice-daily expression such as `0 7,19 * * *` is rejected at deploy time (`Hobby accounts are limited to daily cron jobs`). Hence the single daily schedule in `vercel.json`; use the Refresh button for anything more frequent. Exact per-project job counts on Hobby were not verified — check the current Vercel cron docs if you plan to add more entries.

## Architecture notes

### Ingestion (`lib/refresh.ts`, `lib/feeds.ts`, `lib/http.ts`)

- **Batched upserts.** Articles are inserted in batches of 200 in a single multi-row statement, not one round trip each. A 50-feed refresh is ~10 queries instead of thousands. `ON CONFLICT (feed_id, guid) DO UPDATE` refreshes mutable fields (title, link, content, date) while deliberately preserving `is_read`, so re-fetching never resurrects read articles as unread. `RETURNING (xmax = 0)` distinguishes inserts from updates for accurate reporting.
- **Conditional GET.** `ETag`/`Last-Modified` are stored per feed and replayed; a 304 costs no parse and no write. Conditional headers are only sent **after** a feed has been successfully ingested once — otherwise a feed whose own `Last-Modified` is newer than the moment it was added would 304 on the ingestion pass and its backlog would never import.
- **Bounded concurrency and a time budget.** Feeds are fetched 5 at a time with a 50s budget, so a slow feed cannot blow the function's execution limit. Feeds not reached are reported as `skipped` rather than failing the run.
- **Transient-failure retries, opt-in.** `fetchFeedDocument` defaults to a single attempt. The interactive add-feed path requests 3, because a user is waiting and feed hosts intermittently return 5xx or reset the connection; the bulk refresh keeps one attempt per feed so a dead host is not retried 50 times. Only genuinely transient outcomes are retried (connection errors, timeouts, 408/425/429/5xx) — a 404 or a parse failure never is.
- **Per-feed error state.** Failures record `last_error`/`last_error_at` and increment `error_count`; the sidebar shows a warning marker and the feed header shows the message. `last_fetched_at` is only set on success.

### Folders and tags (`lib/taxonomy.ts`)

- **Folders group feeds**, one level of nesting (`folders.parent_id`). A folder's unread count rolls up its subfolders, so collapsing a folder still shows everything unread inside it. A sibling-uniqueness index on `(coalesce(parent_id, 0), name)` stops duplicate names at the same level.
- **Deleting a folder never deletes content.** Its feeds are promoted to the parent folder (or the top level) and its articles are kept. The API does the promotion explicitly before the delete so the `ON DELETE SET NULL` safety net is not relied on; subfolders cascade.
- **Tags are cross-cutting** (`tags` + `feed_tags` many-to-many), so a tag can span feeds in different folders and is filterable independently of the folder tree. Assigning is idempotent via the composite primary key, names are deduped case-sensitively on write, and tags that end up attached to nothing are pruned so the filter strip does not accumulate orphans.
- **Renaming a tag onto an existing name merges them** rather than failing, and reports `merged: true` so the client can drop a now-invalid selection.
- **Duplicate folder names return 409** via an explicit pre-check, with SQLSTATE `23505` detection through Drizzle's `cause` chain as a backstop for the check/insert race.

### Full-text extraction (`lib/extract.ts`)

- **Detection.** An article is treated as a teaser when its feed body is under 400 characters of text. Those are extracted automatically on open (once per open, so a failure cannot loop) unless auto-extract is switched off.
- **Readability over linkedom.** `@mozilla/readability` needs a DOM; `linkedom` supplies one without a browser environment. This keeps the route on the Node runtime and compatible with the serverless bundle.
- **Sanitized twice.** Once in the extraction pipeline and again on write, so there is a single choke point for anything rendered with `dangerouslySetInnerHTML`.
- **Failures never destroy good data.** A failed re-extraction records `extraction_error` but leaves any existing extracted body in place, so a transient network error does not lose text you already had.
- **Caching is just the column.** A repeat request short-circuits on `extracted_content` (~15ms) instead of refetching.

### Security

- **Auth.** `proxy.ts` (Next 16's renamed middleware) gates every route except `/login`, `/api/auth/*`, and `/api/cron/*`. Sessions are HMAC-SHA256 signed, expiring cookies compared in constant time. Changing `APP_PASSWORD` or `SESSION_SECRET` invalidates all sessions.
- **Cron.** `/api/cron/refresh` requires `Authorization: Bearer $CRON_SECRET` and **fails closed** if the secret is unset. It is exempt from the cookie gate because Vercel Cron cannot send cookies.
- **Feed HTML is untrusted.** Article bodies are sanitized server-side (`lib/parser.ts`, `lib/extract.ts`) before storage: scripts, iframes, event handlers, and `javascript:` URLs are stripped, and links are rewritten with `rel="noopener noreferrer nofollow"`. The reader renders the result with `dangerouslySetInnerHTML`, which is only safe because of that step.
- **SSRF posture.** Feed fetching follows redirects and will request whatever URL is submitted, including internal addresses. This is acceptable for a single-user reader you control; do not expose the "add feed" endpoint to untrusted users. Full-text extraction gives the same warning plus a hostname blocklist (`lib/urlSafety.mjs`).
- **CORS/CSRF.** State-changing routes are same-origin and cookie-authenticated (`SameSite=Lax`); login additionally rejects cross-origin `Origin` headers.

### Rendering

All API routes are `runtime = 'nodejs'` (the parser needs Node built-ins; Edge would fail) and `dynamic = 'force-dynamic'` so no route is prerendered into a stale snapshot.

## Testing

```bash
npm test              # typecheck + splitter tests + HTTP tests (no network, no database)
npm run build
npm run test:e2e      # end-to-end; requires a running server
```

`npm test` covers the two pieces of logic that are hardest to debug in production and easiest to get wrong:

- **`scripts/testSplitStatements.mjs`** — the hand-written SQL splitter in `lib/migrate.mjs`. Every migration statement is sent to the database individually, and several migrations contain dollar-quoted `DO $$ ... $$` blocks with semicolons inside them. It reads the real `drizzle/*.sql` files and asserts nothing is lost or cut in half.
- **`scripts/testHttp.mts`** — transient-failure handling in `lib/http.ts`, using a throwaway local server: retries recover from 5xx, 429, and dropped connections; 404 is never retried; the attempt budget is respected; and `normalizeFeedUrl` rejects non-http schemes.

`scripts/e2e.mjs` seeds its own feeds if the database is empty, then exercises auth (including the negative paths), feed add/duplicate/invalid, pagination, read state toggling, full-text search, refresh idempotency and conditional GET, bulk read operations, HTML sanitization, OPML round-trip, cron authorization, delete cascade, folders (create/nest/rename/duplicate/counts), moving feeds between folders, folder and tag filtering, tag assignment/dedup/pruning/merging, the single-article reader endpoint, and folder-deletion semantics. Pass the base URL and password as arguments if they differ from the defaults:

```bash
node scripts/e2e.mjs http://127.0.0.1:3000 my-password
```

Set `CRON_SECRET` in the environment to also exercise the cron success path. Extraction reaches a live third-party site, so its tests are opt-in:

```bash
CRON_SECRET=... E2E_EXTRACTION=1 node scripts/e2e.mjs
```

Without `E2E_EXTRACTION=1` the suite skips the network-dependent extraction checks but still unit-tests the SSRF guard.

## Troubleshooting

### API routes return 404 (`GET /api/feeds 404`)

The usual cause is a **stale `.next` directory from a dev server that is still running**, not a code problem. `next dev` discovers routes on first request and caches them in `.next/dev/server/app-paths-manifest.json`; an old server holding an outdated manifest will 404 routes that exist on disk. Deleting `.next` while such a server is alive makes it worse, because the routes it is serving from are gone.

Diagnose it by looking at what the build thinks exists:

```bash
cat .next/dev/server/app-paths-manifest.json   # should list every route
find app/api -name route.ts | sort             # compare against what is on disk
```

Recover with a clean restart:

```bash
# 1. Stop every dev/build server for this project (check for more than one!)
pgrep -af 'next dev|next start'

# 2. Clear the build cache and restart
npm run clean
npm run dev
```

To avoid it: never run `next dev` and `next start` against this directory at the same time, and always stop the server before deleting `.next`.

### I pasted my connection string into `.env.example`

`.env.example` is the tracked template and would be committed. Move the value into `.env.local` (gitignored) and restore the placeholder in `.env.example`. Then **rotate the password** in the Neon console — assume anything written into a tracked file has leaked. `.gitignore` ignores `.env*` except `.env.example`, so a stray `.env.production` or backup cannot be committed.

### `RuntimeError: Aborted()` in the logs

PGlite is a WASM Postgres with a file lock. Two processes (or two servers) opening the same `./.pglite-data` directory at once will abort. Run one server at a time, or set `DATABASE_URL` to use Neon instead.

### A column does not exist (e.g. `column articles.extracted_byline does not exist`)

The database is behind the code. Apply migrations:

```bash
npm run db:migrate          # Neon (reads DATABASE_URL from .env.local)
npm run db:migrate:local    # local PGlite
npm run db:reset:local      # nuke the local database and re-apply everything
```

Note that the running server holds its own in-memory PGlite copy, so restart it after migrating.

## Deliberate deviations from the spec

- **`feedsmith` instead of `rss-parser`.** `rss-parser` last shipped in April 2023 and builds on the legacy `xml2js`. `feedsmith` is actively maintained, TypeScript-native, faster, and handles RSS/Atom/RDF/JSON Feed plus OPML, which the optional OPML feature needs anyway.
- **Cron runs once daily**, not twice — see the Hobby limitation above.
- **Local PGlite fallback** so the app is runnable and testable without a cloud database.
- **Readability + linkedom added** so feeds that publish only a teaser still read properly in-app.
- **Added beyond the spec:** password gate, full-text search, OPML import/export, conditional GET, pagination, per-feed error tracking, HTML sanitization, folders, tags, the distraction-free reader, and full-text extraction.

## Not implemented

- Keyboard shortcuts for list navigation (j/k) — the reader has `Esc`/`m`/`o`/`f`/`s`, but the list itself is mouse-driven.
- Multi-user accounts — this is deliberately single-user.
