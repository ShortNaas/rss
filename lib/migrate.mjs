import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Plain JavaScript (not TypeScript) on purpose: this module is loaded both by
 * the Next.js app (which bundles TS fine) and by the standalone
 * `scripts/migrate.mjs` process, where Node cannot import .ts directly.
 *
 * @typedef {(query: string) => Promise<unknown>} SqlExecutor
 */

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle');

/**
 * Applies every .sql file in ./drizzle in filename order, recording what has
 * already run so repeated boots are cheap. The statements themselves are
 * idempotent (`IF NOT EXISTS`, `DO $$` guards), so a re-run is harmless.
 *
 * @param {SqlExecutor} execute
 * @returns {Promise<string[]>} names of migrations applied by this call
 */
export async function runMigrations(execute) {
  if (!existsSync(MIGRATIONS_DIR)) return [];

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) return [];

  await execute(`
    CREATE TABLE IF NOT EXISTS __migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set();
  try {
    const res = await execute('SELECT name FROM __migrations');
    const rows = Array.isArray(res) ? res : (res?.rows ?? []);
    for (const row of rows) applied.add(row.name);
  } catch {
    // Table was just created; nothing applied yet.
  }

  const justApplied = [];

  for (const file of files) {
    if (applied.has(file)) continue;

    const sqlText = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    // Neon's HTTP driver runs one statement per call, and PGlite is happiest
    // that way too, so split rather than sending the whole file.
    const statements = splitStatements(sqlText);
    for (let i = 0; i < statements.length; i++) {
      try {
        await execute(statements[i]);
      } catch (error) {
        // A migration that failed halfway through was never recorded, so the
        // next run replays it from the top. Objects created before the failure
        // already exist; treat those specific errors as "already done" rather
        // than wedging the database permanently.
        if (!isAlreadyExists(error)) throw error;
      }
    }
    await execute(
      `INSERT INTO __migrations (name) VALUES ('${file.replace(/'/g, "''")}') ON CONFLICT DO NOTHING`,
    );
    justApplied.push(file);
  }

  return justApplied;
}

/**
 * Postgres SQLSTATEs meaning "this object is already there".
 * @param {unknown} error
 */
function isAlreadyExists(error) {
  const code = /** @type {{ code?: string, sqlState?: string }} */ (error ?? {});
  const state = code.code ?? code.sqlState;
  return (
    state === '42P07' || // duplicate_table
    state === '42710' || // duplicate_object
    state === '42P06' || // duplicate_schema
    state === '42723' || // duplicate_function
    state === '42P16' // invalid_table_definition (duplicate index/constraint)
  );
}

/**
 * Splits a migration file into individual statements, keeping dollar-quoted
 * bodies ($$ ... $$) intact and ignoring comments.
 *
 * @param {string} sqlText
 * @returns {string[]}
 */
export function splitStatements(sqlText) {
  const statements = [];
  let current = '';
  let dollarTag = null;
  let inSingleQuote = false;
  let inLineComment = false;

  for (let i = 0; i < sqlText.length; i++) {
    const char = sqlText[i];
    const rest = sqlText.slice(i);

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }

    if (dollarTag) {
      if (rest.startsWith(dollarTag)) {
        current += dollarTag;
        i += dollarTag.length - 1;
        dollarTag = null;
      } else {
        current += char;
      }
      continue;
    }

    if (!inSingleQuote && rest.startsWith('--')) {
      inLineComment = true;
      continue;
    }

    if (char === "'" && !inSingleQuote) {
      inSingleQuote = true;
      current += char;
      continue;
    }

    if (char === "'" && inSingleQuote) {
      // Handle escaped '' inside a string literal.
      if (sqlText[i + 1] === "'") {
        current += "''";
        i++;
      } else {
        inSingleQuote = false;
        current += char;
      }
      continue;
    }

    if (!inSingleQuote && char === '$') {
      const match = rest.match(/^\$[A-Za-z_]*\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        i += dollarTag.length - 1;
        continue;
      }
    }

    if (char === ';' && !inSingleQuote) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);

  return statements;
}
