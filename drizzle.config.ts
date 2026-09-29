import type { Config } from 'drizzle-kit';

/**
 * Schema/migration generation only. Applying migrations is handled by
 * `scripts/migrate.mjs`, which targets Neon when DATABASE_URL is set and
 * embedded PGlite otherwise.
 */
export default {
  schema: './lib/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/placeholder',
  },
  strict: false,
  verbose: true,
} satisfies Config;
