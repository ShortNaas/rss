import { NextResponse } from 'next/server';
import { sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { toRows } from '@/lib/feeds';
import { websearchSql } from '@/lib/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Bulk read state change.
 * Body: { isRead?: boolean, feedId?: number, q?: string }
 * Marks every article matching the filter, not just the loaded page.
 */
export async function POST(request: Request) {
  let isRead = true;
  let feedId: number | null = null;
  let search = '';

  try {
    const raw = await request.text();
    if (raw.trim()) {
      const body = JSON.parse(raw) as { isRead?: unknown; feedId?: unknown; q?: unknown };
      if (typeof body.isRead === 'boolean') isRead = body.isRead;
      if (typeof body.feedId === 'number' && Number.isInteger(body.feedId) && body.feedId > 0) {
        feedId = body.feedId;
      }
      if (typeof body.q === 'string') search = body.q.trim().slice(0, 200);
    }
  } catch {
    return NextResponse.json({ error: 'Malformed JSON body' }, { status: 400 });
  }

  const conditions: SQL[] = [sql`is_read = ${!isRead}`];
  if (feedId !== null) conditions.push(sql`feed_id = ${feedId}`);
  if (search) conditions.push(sql`search_vector @@ ${websearchSql(search)}`);

  const db = await getDb();
  const result = await db.execute(sql`
    UPDATE articles
    SET is_read = ${isRead},
        read_at = ${isRead ? sql`now()` : sql`NULL`}
    WHERE ${sql.join(conditions, sql` AND `)}
    RETURNING id
  `);

  const updated = toRows<{ id: number }>(result).length;
  return NextResponse.json({ ok: true, updated, isRead, feedId, query: search || null });
}
