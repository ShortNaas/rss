import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { deleteFeed } from '@/lib/feeds';
import { folderExists } from '@/lib/taxonomy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Removes a feed; its articles go with it via ON DELETE CASCADE. */
export async function DELETE(_request: Request, context: Context) {
  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (id === null) return NextResponse.json({ error: 'Invalid feed id' }, { status: 400 });

  const db = await getDb();
  const existing = await db
    .select({ id: schema.feeds.id })
    .from(schema.feeds)
    .where(eq(schema.feeds.id, id))
    .limit(1);

  if (existing.length === 0) {
    return NextResponse.json({ error: 'Feed not found' }, { status: 404 });
  }

  await deleteFeed(id);
  return NextResponse.json({ ok: true, id });
}

/**
 * Renames a feed and/or moves it into a folder.
 * Body: { title?: string | null, folderId?: number | null }
 * `folderId: null` moves the feed to the top level.
 */
export async function PATCH(request: Request, context: Context) {
  const { id: rawId } = await context.params;
  const id = parseId(rawId);
  if (id === null) return NextResponse.json({ error: 'Invalid feed id' }, { status: 400 });

  let title: string | null | undefined;
  let folderId: number | null | undefined;
  let titleProvided = false;
  let folderProvided = false;

  try {
    const body = (await request.json()) as { title?: unknown; folderId?: unknown };

    if ('title' in body) {
      titleProvided = true;
      if (typeof body.title === 'string') {
        const trimmed = body.title.trim().slice(0, 500);
        title = trimmed.length > 0 ? trimmed : null;
      } else {
        title = null;
      }
    }

    if ('folderId' in body) {
      folderProvided = true;
      if (body.folderId === null || body.folderId === '') {
        folderId = null;
      } else {
        const parsed = Number(body.folderId);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          return NextResponse.json({ error: 'Invalid folderId' }, { status: 400 });
        }
        folderId = parsed;
      }
    }
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  if (!titleProvided && !folderProvided) {
    return NextResponse.json(
      { error: 'Provide "title" and/or "folderId"' },
      { status: 400 },
    );
  }

  if (folderId != null && !(await folderExists(folderId))) {
    return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
  }

  const db = await getDb();
  const updated = await db
    .update(schema.feeds)
    .set({
      ...(titleProvided ? { title } : {}),
      ...(folderProvided ? { folderId } : {}),
    })
    .where(eq(schema.feeds.id, id))
    .returning({ id: schema.feeds.id, title: schema.feeds.title, folderId: schema.feeds.folderId });

  if (updated.length === 0) {
    return NextResponse.json({ error: 'Feed not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, feed: updated[0] });
}
