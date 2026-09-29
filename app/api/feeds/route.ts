import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { getUnreadCounts, listFeeds } from '@/lib/feeds';
import { discoverFeedUrl, fetchFeedDocument, looksLikeFeed, normalizeFeedUrl } from '@/lib/http';
import { parseFeedMetadata } from '@/lib/parser';
import { refreshFeeds } from '@/lib/refresh';
import { getFeedTagMap, listFolders, listTags, folderExists, setFeedTags } from '@/lib/taxonomy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Never expose internal fields like etag to the client. */
function serializeFeed(feed: typeof schema.feeds.$inferSelect) {
  return {
    id: feed.id,
    url: feed.url,
    title: feed.title,
    siteUrl: feed.siteUrl,
    description: feed.description,
    folderId: feed.folderId,
    lastFetchedAt: feed.lastFetchedAt?.toISOString() ?? null,
    lastError: feed.lastError,
    lastErrorAt: feed.lastErrorAt?.toISOString() ?? null,
    errorCount: feed.errorCount,
    createdAt: feed.createdAt.toISOString(),
  };
}

/**
 * Returns everything the sidebar needs in one round trip: feeds, folders,
 * tags, and all the unread counts.
 */
export async function GET() {
  const [feeds, unread, folders, tags, tagMap] = await Promise.all([
    listFeeds(),
    getUnreadCounts(),
    listFolders(),
    listTags(),
    getFeedTagMap(),
  ]);

  const totalUnread = Object.values(unread).reduce((sum, n) => sum + n, 0);

  return NextResponse.json({
    feeds: feeds.map((feed) => ({
      ...serializeFeed(feed),
      unread: unread[feed.id] ?? 0,
      tags: tagMap[feed.id] ?? [],
    })),
    folders,
    tags,
    totalUnread,
  });
}

export async function POST(request: Request) {
  let rawUrl = '';
  let folderId: number | null = null;
  let tagNames: string[] = [];

  try {
    const body = (await request.json()) as {
      url?: unknown;
      folderId?: unknown;
      tags?: unknown;
    };
    rawUrl = typeof body.url === 'string' ? body.url : '';

    if (body.folderId !== undefined && body.folderId !== null) {
      const parsed = Number(body.folderId);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return NextResponse.json({ error: 'Invalid folderId' }, { status: 400 });
      }
      folderId = parsed;
    }

    if (Array.isArray(body.tags)) {
      tagNames = body.tags.filter((tag): tag is string => typeof tag === 'string');
    }
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body with a "url" field' }, { status: 400 });
  }

  if (folderId !== null && !(await folderExists(folderId))) {
    return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
  }

  let url: string;
  try {
    url = normalizeFeedUrl(rawUrl);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid URL' },
      { status: 400 },
    );
  }

  const db = await getDb();
  const existing = await db.select().from(schema.feeds).where(eq(schema.feeds.url, url)).limit(1);
  if (existing.length > 0) {
    return NextResponse.json(
      { error: 'That feed has already been added', feed: serializeFeed(existing[0]) },
      { status: 409 },
    );
  }

  // Fetch once up front so the user gets immediate feedback if the URL is not
  // actually a feed.
  //
  // Retries are enabled here (and only here): this is a user-initiated action
  // waiting on the result, and feed hosts intermittently return 5xx or reset
  // the connection. The bulk refresh keeps a single attempt per feed so a dead
  // host is not retried 50 times.
  const interactiveFetch = { retryAttempts: 3, retryDelayMs: 500 };
  let document = await fetchFeedDocument(url, interactiveFetch);

  // Not a feed? Try to autodiscover one from the HTML page.
  if (document.status === 'ok' && !looksLikeFeed(document.body)) {
    const discovered = await discoverFeedUrl(url);
    if (!discovered) {
      return NextResponse.json(
        {
          error:
            'That URL did not return a feed, and no feed link was found in the page. Paste the feed URL directly.',
        },
        { status: 422 },
      );
    }
    url = discovered;
    document = await fetchFeedDocument(url, interactiveFetch);
  }

  if (document.status === 'error') {
    return NextResponse.json(
      { error: `Could not fetch that feed: ${document.error}` },
      { status: 422 },
    );
  }

  if (document.status === 'not-modified') {
    // No conditional headers were sent, so a 304 here is a server quirk.
    return NextResponse.json(
      { error: 'The feed responded 304 Not Modified unexpectedly. Try again.' },
      { status: 422 },
    );
  }

  let metadata: ReturnType<typeof parseFeedMetadata>;
  try {
    metadata = parseFeedMetadata(document.body);
  } catch (error) {
    return NextResponse.json(
      {
        error: `Could not parse that feed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 422 },
    );
  }

  const inserted = await db
    .insert(schema.feeds)
    .values({
      url,
      title: metadata.title ?? url,
      siteUrl: metadata.siteUrl,
      description: metadata.description,
      folderId,
      etag: document.etag,
      lastModified: document.lastModified,
    })
    .returning();

  const feed = inserted[0];

  // Tags are optional at creation time; assigns on demand and drops orphans.
  const appliedTags = tagNames.length > 0 ? await setFeedTags(feed.id, tagNames) : [];

  // Pull the backlog immediately so the reader is not empty after adding.
  const report = await refreshFeeds({ feedIds: [feed.id] });

  const refreshed = await db.select().from(schema.feeds).where(eq(schema.feeds.id, feed.id)).limit(1);

  // Report autodiscovery only when the stored URL differs from what was typed.
  // `url` is already normalized, so the input must be normalized to match.
  const requested = rawUrl.trim();
  const discoveredFrom = requested === url ? null : url;

  return NextResponse.json(
    {
      feed: {
        ...serializeFeed(refreshed[0] ?? feed),
        unread: report.inserted,
        tags: appliedTags.map((name) => ({ id: 0, name })),
      },
      format: metadata.format,
      added: report.inserted,
      discoveredFrom,
    },
    { status: 201 },
  );
}