import { NextResponse } from 'next/server';
import { sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { toRows } from '@/lib/feeds';
import { websearchSql } from '@/lib/search';
import { folderArticleFilter, tagArticleFilter } from '@/lib/taxonomy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

interface ArticleRow {
  id: number;
  feed_id: number;
  title: string | null;
  link: string | null;
  author: string | null;
  summary: string | null;
  published_at: Date | string | null;
  is_read: boolean;
  feed_title: string | null;
  feed_site_url: string | null;
}

function iso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parsePositiveInt(raw: string | null, fallback: number, max: number): number {
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return fallback;
  return Math.min(value, max);
}

/** Returns a positive integer id, or null when absent/invalid. */
function parseId(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value > 0 ? value : null;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const feedId = parseId(params.get('feedId'));
  const folderId = parseId(params.get('folderId'));
  const tagId = parseId(params.get('tagId'));

  const unreadOnly = ['true', '1', 'yes'].includes((params.get('unread') ?? '').toLowerCase());
  const search = (params.get('q') ?? '').trim().slice(0, 200);
  const limit = parsePositiveInt(params.get('limit'), DEFAULT_LIMIT, MAX_LIMIT);
  const offset = parsePositiveInt(params.get('offset'), 0, 100_000);
  const withContent = params.get('withContent') === 'true';

  const conditions: SQL[] = [];
  if (feedId !== null) conditions.push(sql`a.feed_id = ${feedId}`);
  // Folder filtering includes subfolders; tag filtering is cross-cutting.
  if (folderId !== null) conditions.push(folderArticleFilter(folderId));
  if (tagId !== null) conditions.push(tagArticleFilter(tagId));
  if (unreadOnly) conditions.push(sql`a.is_read = false`);
  if (search) conditions.push(sql`a.search_vector @@ ${websearchSql(search)}`);

  const where = conditions.length
    ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
    : sql``;

  // Relevance ordering only makes sense for a text query.
  const orderBy = search
    ? sql`ORDER BY ts_rank(a.search_vector, ${websearchSql(search)}) DESC, a.published_at DESC NULLS LAST, a.id DESC`
    : sql`ORDER BY a.published_at DESC NULLS LAST, a.id DESC`;

  // `withContent` is off by default because list rows only need a preview; the
  // reader and search-result views opt in.
  const contentColumn = withContent ? sql`, a.content, a.extracted_content` : sql``;

  const db = await getDb();
  const result = await db.execute(sql`
    WITH matched AS (
      SELECT id FROM articles a ${where} ${orderBy} LIMIT ${limit} OFFSET ${offset}
    ),
    totals AS (
      SELECT count(*)::int AS total FROM articles a ${where}
    )
    SELECT
      a.id, a.feed_id, a.title, a.link, a.author, a.summary,
      a.published_at, a.is_read,
      (a.extracted_content IS NOT NULL) AS is_extracted,
      a.extraction_error,
      f.title AS feed_title, f.site_url AS feed_site_url
      ${contentColumn},
      (SELECT total FROM totals) AS total
    FROM matched m
    JOIN articles a ON a.id = m.id
    JOIN feeds f ON f.id = a.feed_id
    ${orderBy}
  `);

  const rows = toRows<
    ArticleRow & {
      content?: string | null;
      extracted_content?: string | null;
      is_extracted?: boolean;
      extraction_error?: string | null;
      total: number;
    }
  >(result);
  const total = rows.length > 0 ? Number(rows[0].total) : 0;

  return NextResponse.json({
    articles: rows.map((row) => ({
      id: Number(row.id),
      feedId: Number(row.feed_id),
      feedTitle: row.feed_title,
      feedSiteUrl: row.feed_site_url,
      title: row.title,
      link: row.link,
      author: row.author,
      summary: row.summary,
      // Prefer extracted text when present, mirroring the reader's behaviour.
      content: row.extracted_content ?? row.content ?? null,
      isExtracted: Boolean(row.is_extracted),
      extractionError: row.extraction_error ?? null,
      publishedAt: iso(row.published_at),
      isRead: Boolean(row.is_read),
    })),
    total,
    limit,
    offset,
    hasMore: offset + rows.length < total,
    query: search || null,
  });
}
