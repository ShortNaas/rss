import 'server-only';

import { eq, inArray } from 'drizzle-orm';
import { getDb, schema } from './db';
import { fetchFeedDocument } from './http';
import { normalizeFeed } from './parser';
import {
  incrementErrorCount,
  toUpsertRow,
  updateFeedStatus,
  upsertArticles,
} from './feeds';

/**
 * Upper bound on total wall time. Serverless functions are killed at a fixed
 * limit (60s on Vercel Hobby for many runtimes); stopping early with a report
 * beats being terminated mid-write.
 */
const DEFAULT_TIME_BUDGET_MS = 50_000;
const DEFAULT_CONCURRENCY = 5;

export type FeedRefreshStatus = 'ok' | 'unchanged' | 'error' | 'skipped';

export interface FeedRefreshResult {
  feedId: number;
  url: string;
  title: string | null;
  status: FeedRefreshStatus;
  inserted?: number;
  updated?: number;
  itemCount?: number;
  format?: string;
  ms: number;
  error?: string;
}

export interface RefreshReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  total: number;
  succeeded: number;
  unchanged: number;
  failed: number;
  skipped: number;
  inserted: number;
  updated: number;
  results: FeedRefreshResult[];
}

export interface RefreshOptions {
  /** Restrict the refresh to specific feeds. Omit to refresh everything. */
  feedIds?: number[];
  concurrency?: number;
  timeBudgetMs?: number;
}

/** Runs `worker` over `items` with a bounded number in flight at once. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });

  await Promise.all(runners);
  return results;
}

async function refreshOne(feed: {
  id: number;
  url: string;
  title: string | null;
  etag: string | null;
  lastModified: string | null;
  lastFetchedAt: Date | null;
}): Promise<FeedRefreshResult> {
  const startedAt = Date.now();
  const base = { feedId: feed.id, url: feed.url, title: feed.title };

  /*
   * Only send conditional headers once this feed has been successfully
   * fetched at least once (proxied by last_fetched_at).
   *
   * Without this guard, a feed whose own `Last-Modified` is newer than the
   * moment we first saw it replies 304 to the *second* request and we would
   * never ingest its backlog: adding a feed fetches once to read metadata,
   * then immediately fetches again to import articles.
   */
  const hasIngestedBefore = feed.lastFetchedAt !== null;

  const response = await fetchFeedDocument(feed.url, {
    etag: hasIngestedBefore ? feed.etag : null,
    lastModified: hasIngestedBefore ? feed.lastModified : null,
  });

  if (response.status === 'not-modified') {
    await updateFeedStatus(feed.id, {
      lastFetchedAt: new Date(),
      lastError: null,
      lastErrorAt: null,
      errorCount: 0,
      etag: response.etag,
      lastModified: response.lastModified,
    });
    return { ...base, status: 'unchanged', ms: Date.now() - startedAt };
  }

  if (response.status === 'error') {
    await updateFeedStatus(feed.id, {
      lastError: response.error,
      lastErrorAt: new Date(),
      errorCount: incrementErrorCount,
    });
    return { ...base, status: 'error', error: response.error, ms: Date.now() - startedAt };
  }

  try {
    const normalized = normalizeFeed(response.body);
    const rows = normalized.items.map((item) => toUpsertRow(feed.id, item));
    const counts = await upsertArticles(rows);

    await updateFeedStatus(feed.id, {
      // Adopt the feed's own title only when we have nothing better; a
      // user-visible rename in the DB wins.
      title: feed.title ?? normalized.title,
      siteUrl: normalized.siteUrl,
      description: normalized.description,
      lastFetchedAt: new Date(),
      lastError: null,
      lastErrorAt: null,
      errorCount: 0,
      etag: response.etag,
      lastModified: response.lastModified,
    });

    return {
      ...base,
      title: feed.title ?? normalized.title,
      status: 'ok',
      inserted: counts.inserted,
      updated: counts.updated,
      itemCount: rows.length,
      format: normalized.format,
      ms: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateFeedStatus(feed.id, {
      lastError: `Parse failed: ${message}`,
      lastErrorAt: new Date(),
      errorCount: incrementErrorCount,
    });
    return {
      ...base,
      status: 'error',
      error: `Parse failed: ${message}`,
      ms: Date.now() - startedAt,
    };
  }
}

/**
 * Fetches every feed (or the given subset) and upserts its articles.
 * Never throws for an individual feed failure — the report carries the errors.
 */
export async function refreshFeeds(options: RefreshOptions = {}): Promise<RefreshReport> {
  const startedAt = new Date();
  const budget = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const deadline = Date.now() + budget;

  const db = await getDb();
  const allFeeds = options.feedIds?.length
    ? await db.select().from(schema.feeds).where(inArray(schema.feeds.id, options.feedIds))
    : await db.select().from(schema.feeds).orderBy(schema.feeds.id);

  const results = await mapWithConcurrency(allFeeds, concurrency, async (feed) => {
    if (Date.now() > deadline) {
      return {
        feedId: feed.id,
        url: feed.url,
        title: feed.title,
        status: 'skipped' as const,
        error: 'Time budget exhausted; run again to continue',
        ms: 0,
      };
    }

    try {
      return await refreshOne({
        id: feed.id,
        url: feed.url,
        title: feed.title,
        etag: feed.etag,
        lastModified: feed.lastModified,
        lastFetchedAt: feed.lastFetchedAt,
      });
    } catch (error) {
      // A failure in the status bookkeeping itself must not kill the batch.
      return {
        feedId: feed.id,
        url: feed.url,
        title: feed.title,
        status: 'error' as const,
        error: error instanceof Error ? error.message : String(error),
        ms: 0,
      };
    }
  });

  const finishedAt = new Date();
  const sum = (key: 'inserted' | 'updated') =>
    results.reduce((total, r) => total + (r[key] ?? 0), 0);

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    total: results.length,
    succeeded: results.filter((r) => r.status === 'ok').length,
    unchanged: results.filter((r) => r.status === 'unchanged').length,
    failed: results.filter((r) => r.status === 'error').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    inserted: sum('inserted'),
    updated: sum('updated'),
    results,
  };
}

/** Convenience wrapper for a single feed, used by POST /api/refresh?feedId=. */
export function refreshFeed(feedId: number): Promise<RefreshReport> {
  return refreshFeeds({ feedIds: [feedId] });
}
