/**
 * Read-only Neon connection check.
 *
 * Run with: npm run db:check
 *
 * Deliberately does NOT import lib/db.ts, because that runs migrations as a
 * side effect. A diagnostic must not mutate the database it is inspecting.
 *
 * Exits non-zero if the database is unusable or behind on migrations, so it can
 * be used as a gate before starting the app or deploying.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';

const EXPECTED_TABLES = ['articles', 'feeds', 'feed_tags', 'folders', 'tags'];

let passed = 0;
let failed = 0;
let warned = 0;

function pass(name, detail = '') {
  passed += 1;
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail = '') {
  failed += 1;
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}
function warn(name, detail = '') {
  warned += 1;
  console.log(`  WARN  ${name}${detail ? ` — ${detail}` : ''}`);
}
function info(message) {
  console.log(`        ${message}`);
}

/** Coerces a driver result to rows (Neon returns a bare array). */
function toRows(result) {
  if (Array.isArray(result)) return result;
  const rows = result?.rows;
  return Array.isArray(rows) ? rows : [];
}

/** Masks the password so a connection string can be printed safely. */
function maskConnectionString(raw) {
  try {
    const url = new URL(raw);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return '(unparseable)';
  }
}

function migrationFilesOnDisk() {
  try {
    return readdirSync(join(process.cwd(), 'drizzle'))
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch {
    return [];
  }
}

console.log('\nNeon connection check\n');

// --- backend selection -----------------------------------------------------
console.log('backend');
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  fail('DATABASE_URL is set', 'not set');
  info('Without it the app silently falls back to local PGlite in ./.pglite-data.');
  info('Create .env.local with DATABASE_URL from the Neon dashboard (use the pooled string).');
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(1);
}

pass('DATABASE_URL is set');
info(maskConnectionString(connectionString));

let url;
try {
  url = new URL(connectionString);
} catch {
  fail('DATABASE_URL parses as a URL');
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(1);
}

if (/^postgres(ql)?:$/.test(url.protocol)) pass('uses a postgres:// scheme', url.protocol);
else fail('uses a postgres:// scheme', `got ${url.protocol}`);

if (url.hostname.includes('-pooler')) {
  pass('host is the pooled endpoint', url.hostname);
} else {
  warn(
    'host looks like a direct (non-pooled) endpoint',
    url.hostname,
  );
  info('Fine for this HTTP driver, but the pooled host is what you want on Vercel.');
}

if ((url.searchParams.get('sslmode') ?? '') === 'require') pass('sslmode=require is present');
else warn('sslmode=require is missing', 'Neon normally appends it; the driver may refuse plaintext');
if (url.password) pass('password is present in the URL');
else warn('no password in the URL');

// --- connectivity ----------------------------------------------------------
console.log('\nconnectivity');
const sql = neon(connectionString);

try {
  const rows = toRows(await sql.query('SELECT version() AS version, current_database() AS db'));
  const version = String(rows[0]?.version ?? '');
  pass('connected', String(rows[0]?.db ?? 'unknown database'));
  info(version.split(' ').slice(0, 2).join(' ') || 'version unavailable');
} catch (error) {
  fail('connected', error instanceof Error ? error.message : String(error));
  info('Check that the project is not suspended and the host/credentials are correct.');
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(1);
}

// --- migrations ------------------------------------------------------------
console.log('\nmigrations');
const onDisk = migrationFilesOnDisk();
if (onDisk.length === 0) {
  fail('found migration files in ./drizzle');
} else {
  pass('found migration files on disk', `${onDisk.length} file(s)`);
}

let applied = [];
try {
  const rows = toRows(await sql.query('SELECT name FROM __migrations ORDER BY name'));
  applied = rows.map((row) => String(row.name));
  pass('migration tracking table is readable', `${applied.length} applied`);
} catch {
  // Table absent means nothing has been applied yet.
  warn('migration tracking table does not exist yet', 'run: npm run db:migrate');
}

const pending = onDisk.filter((file) => !applied.includes(file));
if (pending.length === 0) {
  pass('all migrations are applied');
} else {
  fail('all migrations are applied', `${pending.length} pending: ${pending.join(', ')}`);
  info('Run: npm run db:migrate');
}

// --- schema ----------------------------------------------------------------
console.log('\nschema');
let tables = [];
try {
  const rows = toRows(
    await sql.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    ),
  );
  tables = rows.map((row) => String(row.tablename));
  pass('read the table list', `${tables.length} table(s)`);
  info(tables.join(', ') || '(none)');
} catch (error) {
  fail('read the table list', error instanceof Error ? error.message : String(error));
}

const missing = EXPECTED_TABLES.filter((table) => !tables.includes(table));
if (missing.length === 0) {
  pass('all expected tables exist');
} else {
  fail('all expected tables exist', `missing: ${missing.join(', ')}`);
  info('Run: npm run db:migrate');
}

// The full-text search column is created by hand-written migration 0001, so
// confirm it landed rather than assuming.
try {
  const rows = toRows(
    await sql.query(
      "SELECT data_type FROM information_schema.columns WHERE table_name = 'articles' AND column_name = 'search_vector'",
    ),
  );
  if (rows.length > 0 && String(rows[0].data_type) === 'tsvector') {
    pass('articles.search_vector exists as tsvector');
  } else {
    fail('articles.search_vector exists as tsvector', rows.length ? String(rows[0].data_type) : 'missing');
  }
} catch (error) {
  fail('check articles.search_vector', error instanceof Error ? error.message : String(error));
}

console.log(
  `\n${passed} passed, ${failed} failed${warned ? `, ${warned} warning(s)` : ''}\n`,
);
process.exit(failed === 0 ? 0 : 1);
