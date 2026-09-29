import { NextResponse } from 'next/server';
import { listFeeds } from '@/lib/feeds';
import { buildOpml } from '@/lib/opml';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Downloads every subscription as an OPML file. */
export async function GET() {
  const feeds = await listFeeds();
  const opml = buildOpml(feeds);
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(opml, {
    headers: {
      'content-type': 'text/x-opml; charset=utf-8',
      'content-disposition': `attachment; filename="rss-reader-${stamp}.opml"`,
      'cache-control': 'no-store',
    },
  });
}
