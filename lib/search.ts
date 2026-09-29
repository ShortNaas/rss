import { sql } from 'drizzle-orm';

/**
 * SQL fragment that builds a weighted tsvector for one article.
 * Title matches rank above summary, which rank above body text.
 *
 * `'english'` is hardcoded to match the index; if you change it, the GIN index
 * in drizzle/0001_full_text_search.sql must be rebuilt to match.
 */
export function searchVectorSql(title: unknown, summary: unknown, content: unknown) {
  return sql`setweight(to_tsvector('english', coalesce(${title}, '')), 'A')
    || setweight(to_tsvector('english', coalesce(${summary}, '')), 'B')
    || setweight(to_tsvector('english', coalesce(${content}, '')), 'C')`;
}

/**
 * Turns user input into a tsquery. `websearch_to_tsquery` understands quoted
 * phrases, OR, and -exclusions, and never raises on malformed input — unlike
 * `to_tsquery`, which errors on stray operators.
 */
export function websearchSql(query: string) {
  return sql`websearch_to_tsquery('english', ${query})`;
}
