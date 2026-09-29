import { NextResponse } from 'next/server';
import {
  createFolder,
  deleteFolder,
  folderExists,
  folderNameExists,
  getFolderParentId,
  isUniqueViolation,
  listFolders,
  renameFolder,
} from '@/lib/taxonomy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_NAME = 100;

function parseId(raw: unknown): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** Folder tree with rolled-up feed and unread counts. */
export async function GET() {
  return NextResponse.json({ folders: await listFolders() });
}

export async function POST(request: Request) {
  let name = '';
  let parentId: number | null = null;

  try {
    const body = (await request.json()) as { name?: unknown; parentId?: unknown };
    if (typeof body.name === 'string') name = body.name.trim().slice(0, MAX_NAME);
    if (body.parentId !== undefined && body.parentId !== null) {
      parentId = parseId(body.parentId);
      if (parentId === null) {
        return NextResponse.json({ error: 'Invalid parentId' }, { status: 400 });
      }
    }
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body with a "name" field' }, { status: 400 });
  }

  if (!name) return NextResponse.json({ error: 'Folder name is required' }, { status: 400 });

  if (parentId !== null) {
    const parent = await folderExists(parentId);
    if (!parent) return NextResponse.json({ error: 'Parent folder not found' }, { status: 404 });

    // Keep the tree two levels deep so the sidebar stays predictable.
    const parentParentId = await getFolderParentId(parentId);
    if (parentParentId !== null && parentParentId !== undefined) {
      return NextResponse.json(
        { error: 'Folders can only be nested one level deep' },
        { status: 400 },
      );
    }
  }

  if (await folderNameExists(name, parentId)) {
    return NextResponse.json(
      { error: `A folder named “${name}” already exists here` },
      { status: 409 },
    );
  }

  try {
    const folder = await createFolder(name, parentId);
    return NextResponse.json({ folder }, { status: 201 });
  } catch (error) {
    // Backstop for the race between the check above and the insert.
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: `A folder named “${name}” already exists here` },
        { status: 409 },
      );
    }
    throw error;
  }
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

  if (id === null) return NextResponse.json({ error: 'Invalid folder id' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'Folder name is required' }, { status: 400 });
  if (!(await folderExists(id))) {
    return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
  }

  const parentId = (await getFolderParentId(id)) ?? null;
  if (await folderNameExists(name, parentId, id)) {
    return NextResponse.json(
      { error: `A folder named “${name}” already exists here` },
      { status: 409 },
    );
  }

  try {
    await renameFolder(id, name);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: `A folder named “${name}” already exists here` },
        { status: 409 },
      );
    }
    throw error;
  }

  return NextResponse.json({ ok: true, id, name });
}

export async function DELETE(request: Request) {
  const id = parseId(new URL(request.url).searchParams.get('id'));
  if (id === null) return NextResponse.json({ error: 'Invalid folder id' }, { status: 400 });
  if (!(await folderExists(id))) {
    return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
  }

  await deleteFolder(id);
  return NextResponse.json({ ok: true, id, feedsMovedToParent: true });
}
