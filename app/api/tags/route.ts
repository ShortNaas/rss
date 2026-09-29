import { NextResponse } from 'next/server';
import { deleteTag, listTags, renameTag, tagExists } from '@/lib/taxonomy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_NAME = 60;

function parseId(raw: unknown): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** Tags with feed and unread counts. */
export async function GET() {
  return NextResponse.json({ tags: await listTags() });
}

export async function PATCH(request: Request) {
  let id: number | null = null;
  let name = '';

  try {
    const body = (await request.json()) as { id?: unknown; name?: unknown };
    id = parseId(body.id);
    if (typeof body.name === 'string') name = body.name.trim().slice(0, MAX_NAME);
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  if (id === null) return NextResponse.json({ error: 'Invalid tag id' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'Tag name is required' }, { status: 400 });
  if (!(await tagExists(id))) {
    return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
  }

  // Renaming onto an existing tag merges the two; the returned id is the
  // surviving tag.
  const survivingId = await renameTag(id, name);
  return NextResponse.json({ ok: true, id: survivingId, merged: survivingId !== id, name });
}

export async function DELETE(request: Request) {
  const id = parseId(new URL(request.url).searchParams.get('id'));
  if (id === null) return NextResponse.json({ error: 'Invalid tag id' }, { status: 400 });
  if (!(await tagExists(id))) {
    return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
  }

  await deleteTag(id);
  return NextResponse.json({ ok: true, id });
}
