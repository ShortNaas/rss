import 'server-only';

import { neon } from '@neondatabase/serverless';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { runMigrations } from './migrate.mjs';
import * as schema from './schema';

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * Two drivers, chosen by one env var:
 *   DATABASE_URL set -> Neon serverless HTTP driver (production / Vercel).
 *   unset            -> embedded PGlite, so the app runs with zero cloud setup.
 *
 * Both are Postgres, so the schema, migrations, and SQL (including full-text
 * search) are identical; only the transport differs.
 */
const globalForDb = globalThis as unknown as {
  __rssDb?: Database;
  __rssDbReady?: Promise<Database>;
  __rssPglite?: unknown;
};

export const isNeon = Boolean(process.env.DATABASE_URL);

async function createDatabase(): Promise<Database> {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString) {
    const sql = neon(connectionString);
    await runMigrations((query) => sql.query(query));
    return drizzleNeon(sql, { schema }) as unknown as Database;
  }

  // Imported lazily so Neon-only deployments never load the WASM engine.
  const { PGlite } = await import('@electric-sql/pglite');
  const dataDir = process.env.PGLITE_DATA_DIR ?? './.pglite-data';

  const pg =
    (globalForDb.__rssPglite as InstanceType<typeof PGlite> | undefined) ??
    new PGlite(dataDir);
  globalForDb.__rssPglite = pg;
  await pg.waitReady;

  // query() (not exec()) so the result rows are returned; runMigrations reads
  // the already-applied list from it.
  await runMigrations((query) => pg.query(query));

  const { drizzle } = await import('drizzle-orm/pglite');
  return drizzle(pg, { schema }) as unknown as Database;
}

/**
 * Resolves the database handle, running any pending migrations exactly once
 * per process. Route handlers call this instead of importing a live client, so
 * the connection is only established when a request actually needs data.
 */
export function getDb(): Promise<Database> {
  if (globalForDb.__rssDb) return Promise.resolve(globalForDb.__rssDb);

  globalForDb.__rssDbReady ??= createDatabase()
    .then((database) => {
      globalForDb.__rssDb = database;
      return database;
    })
    .catch((error) => {
      // Let the next request retry rather than caching a rejected promise.
      globalForDb.__rssDbReady = undefined;
      throw error;
    });

  return globalForDb.__rssDbReady;
}

export { schema };
