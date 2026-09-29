/**
 * Applies ./drizzle/*.sql.
 *
 * With DATABASE_URL set -> Neon (serverless HTTP driver).
 * Without it        -> embedded PGlite, so the app is runnable with no cloud
 *                      account. Data lives in ./.pglite-data.
 */
import { neon } from '@neondatabase/serverless';
import { PGlite } from '@electric-sql/pglite';
import { runMigrations } from '../lib/migrate.mjs';

const connectionString = process.env.DATABASE_URL;

if (connectionString) {
  const sql = neon(connectionString);
  const applied = await runMigrations((q) => sql.query(q));
  console.log(
    applied.length
      ? `Neon: applied ${applied.length} migration(s): ${applied.join(', ')}`
      : 'Neon: database already up to date.',
  );
} else {
  const dataDir = process.env.PGLITE_DATA_DIR ?? './.pglite-data';
  const pg = new PGlite(dataDir);
  await pg.waitReady;
  // query() (not exec()) because it resolves to the result rows, which
  // runMigrations needs to read the already-applied list.
  const applied = await runMigrations((q) => pg.query(q));
  console.log(
    applied.length
      ? `PGlite (${dataDir}): applied ${applied.length} migration(s): ${applied.join(', ')}`
      : `PGlite (${dataDir}): database already up to date.`,
  );
  await pg.close();
}
