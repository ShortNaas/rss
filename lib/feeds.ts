import 'server-only';

import { sql, type SQL } from 'drizzle-orm';
import { getDb, schema } from './db';
import { searchVectorSql } from './search';
import type { NormalizedItem } from './parser';

const BATCH_SIZE = 200;

export interface UpsertCounts {
  inserted: number;
  updated: number;
}

export type UpsertRow = {
  feedId: number;
  guid: string;
  title: string | null;
  link: string | null;
  author: string | null;
  content: string | null;
  summary: string | null;
  publishedAt: Date | null;
  searchVector: ReturnType<typeof searchVectorSql>;
};

/**
 * Inserts articles in batches of BATCH_SIZE instead of one statement per item.
 * A 50-feed refresh inserting 2,000 articles would otherwise be 2,000 round
 * trips to Neon; this makes it ~10.
 *
 * On conflict (same feed + guid) it refreshes the mutable fields while leaving
 * is_read/read_at alone, so re-fetching a feed never resurrects read articles
 * as unread.
 *
 * `xmax = 0` distinguishes inserted rows from updated ones in an upsert, which
 * is how the refresh report gets accurate "N new" numbers.
 */
export async function upsertArticles(rows: UpsertRow[]): Promise<UpsertCounts> {
  const counts: UpsertCounts = { inserted: 0, updated: 0 };
  if (rows.length === 0) return counts;

  const db = await getDb();

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    const result = await db.execute(sql`
      INSERT INTO articles
        (feed_id, guid, title, link, author, content, summary, published_at, is_read, search_vector)
      VALUES ${sql.join(
        batch.map(
          (row) => sql`(
            ${row.feedId},
            ${row.guid},
            ${row.title},
            ${row.link},
            ${row.author},
            ${row.content},
            ${row.summary},
            ${row.publishedAt},
            false,
            ${row.searchVector}
          )`,
        ),
        sql`, `,
      )}
      ON CONFLICT (feed_id, guid) DO UPDATE SET
        title        = excluded.title,
        link         = excluded.link,
        author       = excluded.author,
        content      = excluded.content,
        summary      = excluded.summary,
        published_at = excluded.published_at,
        search_vector = excluded.search_vector
      RETURNING (xmax = 0) AS inserted
    `);

    for (const row of toRows<{ inserted: boolean }>(result)) {
      if (row.inserted) counts.inserted += 1;
      else counts.updated += 1;
    }
  }

  return counts;
}

export async function listFeeds() {
  const db = await getDb();
  return db.select().from(schema.feeds).orderBy(schema.feeds.title, schema.feeds.id);
}

/** Unread totals keyed by feed id, for the sidebar badges. */
export async function getUnreadCounts(): Promise<Record<number, number>> {
  const db = await getDb();
  const result = await db.execute(sql`
    SELECT feed_id, count(*)::int AS unread
    FROM articles
    WHERE is_read = false
    GROUP BY feed_id
  `);

  const counts: Record<number, number> = {};
  for (const row of toRows<{ feed_id: number; unread: number }>(result)) {
    counts[Number(row.feed_id)] = Number(row.unread);
  }
  return counts;
}

export interface FeedStatusPatch {
  title?: string | null;
  siteUrl?: string | null;
  description?: string | null;
  etag?: string | null;
  lastModified?: string | null;
  lastFetchedAt?: Date | null;
  lastError?: string | null;
  lastErrorAt?: Date | null;
  /** Plain number, or a SQL expression for an atomic increment. */
  errorCount?: number | SQL;
}

/** `error_count = error_count + 1`, evaluated by the database. */
export const incrementErrorCount = sql`${schema.feeds.errorCount} + 1`;

export async function updateFeedStatus(feedId: number, patch: FeedStatusPatch) {
  const db = await getDb();
  await db
    .update(schema.feeds)
    .set(patch)
    .where(sql`${schema.feeds.id} = ${feedId}`);
}

export async function deleteFeed(feedId: number) {
  const db = await getDb();
  // Articles are removed by the ON DELETE CASCADE foreign key.
  await db.delete(schema.feeds).where(sql`${schema.feeds.id} = ${feedId}`);
}

/**
 * Coerces a driver result to a rows array. Neon's HTTP driver returns the rows
 * array directly, while PGlite returns `{ rows }`.
 */
export function toRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export function toUpsertRow(feedId: number, item: NormalizedItem): UpsertRow {
  return {
    feedId,
    guid: item.guid,
    title: item.title,
    link: item.link,
    author: item.author,
    content: item.content,
    summary: item.summary,
    publishedAt: item.publishedAt,
    searchVector: searchVectorSql(item.title, item.summary, item.content),
  };
}
