# RSS Reader

A single-user RSS reader: Next.js (App Router) + Neon Postgres + Vercel Cron, with a password gate.

## Quick start

Runs with **zero configuration** — with no database configured it uses embedded PGlite (a real Postgres compiled to WASM) in `./.pglite-data`.

```bash
npm install
cp .env.example .env.local   # optional locally; required before deploying
npm run dev
```

Open http://localhost:3000. The app shows a banner while running on PGlite. Set `DATABASE_URL` to switch to Neon — see [Database setup](#database-setup).

## Features

- **Feeds** — add by URL, or paste any site URL and the feed is autodiscovered from its `<link rel="alternate">`. Refresh on demand (all feeds or one); a daily Vercel Cron handles the rest.
- **Distraction-free reader** — clicking an article replaces the list, sidebar, and header with a full-screen reading view: serif text, adjustable size, reading-progress bar, and a **Read from source** option throughout.
- **Full-text extraction** — feeds that publish only a teaser (BBC, Hacker News) get the article body pulled from the source page automatically.
- **Folders and tags** — folders group feeds in a collapsible tree with rolled-up unread counts; tags are cross-cutting labels filterable across folders.
- **Search** — full-text across titles and article bodies (Postgres `tsvector` + GIN index).
- **OPML** import and export.
- **Three themes** — light (warm off-white), sepia reading mode (**default**), and dark. Cycling is on the header button.
- Read/unread state, mark-all-read, unread badges, pagination.

### Reader keyboard shortcuts

| Key | Action |
|---|---|
| `Esc` | Close the reader |
| `m` | Toggle read/unread |
| `o` | Open the original at the source |
| `f` | Fetch/refresh the full text |
| `s` | Cycle text size |

Opening an article marks it read (the usual convention); the checkbox or `m` undoes that.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Production | Neon **pooled** connection string. Unset → local PGlite. |
| `APP_PASSWORD` | Strongly recommended | Enables the login gate. **Unset means the app is completely open.** |
| `SESSION_SECRET` | Recommended | Signs the session cookie. Defaults to `APP_PASSWORD`. |
| `CRON_SECRET` | For cron | Required by `/api/cron/refresh`; Vercel sends it automatically. |
| `PROXY_BASE_URL` | No | Fetch proxy for extraction when a site blocks your server's IP. Target URL is appended to it. |
| `PROXY_SECRET` | No | Sent as `x-proxy-secret` on extraction requests. |
| `PROXY_AUTH` | No | Sent as `x-proxy-auth` on extraction requests, for proxies needing a second credential. |
| `PGLITE_DATA_DIR` | No | Overrides where the local PGlite database lives. |

`.env.local` is gitignored; `.env.example` is the tracked template. **Never put real credentials in `.env.example`.**

## Database setup

The app uses **Neon** when `DATABASE_URL` is set and **embedded PGlite** when it is not. No code change is involved (`lib/db.ts`).

### Neon (production)

1. Create a project at [console.neon.tech](https://console.neon.tech) → **New Project**.
2. Open **Connect** and turn on the **Pooled connection** toggle — the host must contain `-pooler`.
3. Put the string in `.env.local` and apply migrations:

```bash
npm run db:migrate   # applies all migrations
npm run db:check     # read-only: connection, migrations, tables
npm run dev
```

Migrations are tracked in `__migrations` and are idempotent, so re-running is safe. They also apply automatically on first request, which means a fresh deploy needs no manual step — running them explicitly first just surfaces failures immediately.

`db:check` exits non-zero on any problem and warns if the host is not pooled or `sslmode` is missing.

> **Free tier scales to zero** — the first request after an idle period takes a few seconds to wake the compute. That is expected, not a timeout.

<details>
<summary>Using the Neon CLI instead of the dashboard</summary>

```bash
npx neonctl auth                            # browser, or set NEON_API_KEY
npx neonctl link --project-id <id> --branch production -y
npx neonctl connection-string --pooled      # -> DATABASE_URL
```

`neon auth` cannot run headlessly. Note that `neon config init` / `neon deploy` / `neon.ts` belong to the **Neon Functions config pack** and are unrelated to this app.
</details>

### Local PGlite (default)

Nothing to configure. Useful commands:

```bash
npm run db:migrate:local   # apply migrations to ./.pglite-data
npm run db:reset:local     # wipe it and re-apply everything
```

> **PGlite is single-process only.** Two servers (e.g. `next dev` and `next start`) opening the same `./.pglite-data` will abort with `RuntimeError: Aborted()`. Neon has no such restriction.

### Schema changes

Migrations live in `drizzle/`, and two of them (`0001`, `0003`) are hand-written because drizzle-kit cannot express `tsvector`/GIN indexes or guarded `ADD COLUMN`. See [docs/architecture.md](docs/architecture.md#migrations).

```bash
npm run db:generate   # after editing lib/schema.ts
```

## Deploying to Vercel

1. Create the Neon project and copy the **pooled** connection string.
2. Import the repo and set `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`, and `CRON_SECRET`.
3. Deploy. `vercel.json` runs `/api/cron/refresh` once daily at 07:00 UTC.

> **Hobby plan cron limit:** Vercel rejects schedules that run more than **once per day** on Hobby, so a twice-daily expression like `0 7,19 * * *` fails at deploy time. Use the Refresh button for anything more frequent.

## Testing

```bash
npm test           # typecheck + unit tests: no network, no database
npm run build
npm run test:e2e   # end-to-end; requires a running server
```

`npm test` covers the SQL statement splitter (`scripts/testSplitStatements.mjs`) and HTTP retry/URL handling (`scripts/testHttp.mts`). Both target logic that is easy to get wrong and hard to debug in production.

`npm run test:e2e` seeds its own feeds if the database is empty and exercises the full API surface. Pass a base URL or password if they differ from the defaults:

```bash
node scripts/e2e.mjs http://127.0.0.1:3000 my-password
CRON_SECRET=... E2E_EXTRACTION=1 node scripts/e2e.mjs   # include live extraction
```

## Troubleshooting

**API routes return 404** (e.g. `GET /api/feeds 404`) — almost always a stale `.next` from a dev server that is still running, not a code problem. `next dev` caches discovered routes in `.next/dev/server/app-paths-manifest.json`, so an old server 404s routes that exist on disk.

```bash
pgrep -af 'next dev|next start'   # stop every server for this project first
npm run clean                     # rm -rf .next
npm run dev
```

Never run `next dev` and `next start` against this directory at the same time, and always stop the server before deleting `.next`.

**`RuntimeError: Aborted()`** — two processes share `./.pglite-data`. Run one server, or use Neon.

**A column does not exist** — the database is behind the code. Run `npm run db:migrate` (Neon) or `npm run db:migrate:local` (PGlite), then restart the server: a running server holds its own PGlite copy.

**Extraction fails on some sites** — paywalls and script-rendered pages legitimately fail; the reader offers a retry and a "Read from source" fallback. If a site blocks your server's IP, set `PROXY_BASE_URL`.

**I pasted a real connection string into `.env.example`** — move it to `.env.local`, restore the placeholder, and **rotate the password**. Assume anything written to a tracked file has leaked.

## Notes and scope

- **Single-user by design.** There are no accounts; `APP_PASSWORD` gates the whole app.
- **Not implemented:** keyboard navigation of the article list (`j`/`k`), and multi-user accounts.
- **Deviations from the original spec:** `feedsmith` replaces `rss-parser` (unmaintained since 2023); cron runs once daily because of the Hobby limit; PGlite was added as a zero-setup local fallback; and folders, tags, full-text search, extraction, OPML, and the password gate go beyond it.

Design rationale, schema details, and security posture: [docs/architecture.md](docs/architecture.md).
