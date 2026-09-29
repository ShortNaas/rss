import { NextResponse } from 'next/server';
import { refreshFeed, refreshFeeds } from '@/lib/refresh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The refresh loop enforces its own time budget below this ceiling.
export const maxDuration = 60;

/**
 * Manual refresh, triggered by the UI.
 * Optional body: { feedId?: number } to refresh a single feed.
 */
export async function POST(request: Request) {
  let feedId: number | null = null;

  const raw = await request.text();
  if (raw.trim()) {
    try {
      const body = JSON.parse(raw) as { feedId?: unknown };
      if (typeof body.feedId === 'number' && Number.isInteger(body.feedId) && body.feedId > 0) {
        feedId = body.feedId;
      }
    } catch {
      return NextResponse.json({ error: 'Malformed JSON body' }, { status: 400 });
    }
  }

  const report =
    feedId === null
      ? await refreshFeeds()
      : await refreshFeed(feedId);

  return NextResponse.json(report);
}
