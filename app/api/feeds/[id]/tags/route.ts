import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { listTags, setFeedTags } from '@/lib/taxonomy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

const MAX_TAGS = 25;

/**
 * Replaces a feed's tags wholesale.
 * Body: { tags: string[] } — pass [] to clear.
 * Tags are created on demand and orphaned tags are pruned.
 */
export async function PUT(request: Request, context: Context) {
  const { id: rawId } = await context.params;
  const feedId = Number(rawId);
  if (!Number.isInteger(feedId) || feedId <= 0) {
    return NextResponse.json({ error: 'Invalid feed id' }, { status: 400 });
  }

  let names: string[] = [];
  try {
    const body = (await request.json()) as { tags?: unknown };
    if (body.tags !== undefined && !Array.isArray(body.tags)) {
      return NextResponse.json({ error: '"tags" must be an array of strings' }, { status: 400 });
    }
    names = Array.isArray(body.tags)
      ? body.tags
          .filter((tag): tag is string => typeof tag === 'string')
          .map((tag) => tag.trim().slice(0, 60))
          .filter(Boolean)
          .slice(0, MAX_TAGS)
      : [];
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body with a "tags" array' }, { status: 400 });
  }

  const db = await getDb();
  const existing = await db
    .select({ id: schema.feeds.id })
    .from(schema.feeds)
    .where(eq(schema.feeds.id, feedId))
    .limit(1);

  if (existing.length === 0) {
    return NextResponse.json({ error: 'Feed not found' }, { status: 404 });
  }

  const applied = await setFeedTags(feedId, names);
  return NextResponse.json({ ok: true, feedId, tags: applied, allTags: await listTags() });
}
