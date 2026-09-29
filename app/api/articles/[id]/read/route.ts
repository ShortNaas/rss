import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * Sets the read state of one article.
 * Body (all optional): { isRead?: boolean, read?: boolean }
 * With no body the state is toggled.
 */
export async function POST(request: Request, context: Context) {
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid article id' }, { status: 400 });
  }

  let explicit: boolean | null = null;
  const bodyText = await request.text();
  if (bodyText.trim().length > 0) {
    try {
      const body = JSON.parse(bodyText) as { isRead?: unknown; read?: unknown };
      const candidate = body.isRead ?? body.read;
      if (typeof candidate === 'boolean') explicit = candidate;
    } catch {
      return NextResponse.json({ error: 'Malformed JSON body' }, { status: 400 });
    }
  }

  const db = await getDb();
  const existing = await db
    .select({ id: schema.articles.id, isRead: schema.articles.isRead })
    .from(schema.articles)
    .where(eq(schema.articles.id, id))
    .limit(1);

  if (existing.length === 0) {
    return NextResponse.json({ error: 'Article not found' }, { status: 404 });
  }

  const isRead = explicit ?? !existing[0].isRead;

  await db
    .update(schema.articles)
    .set({ isRead, readAt: isRead ? new Date() : null })
    .where(eq(schema.articles.id, id));

  return NextResponse.json({ ok: true, id, isRead });
}
