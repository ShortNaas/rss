import 'server-only';

import { sql, type SQL } from 'drizzle-orm';
import { getDb } from './db';
import { toRows } from './feeds';

/**
 * Folders and tags.
 *
 * Folders form a two-level tree (folder -> subfolder) and group feeds.
 * Tags are many-to-many labels that cut across folders.
 */

export interface FolderNode {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder: number;
  /** Feeds directly in this folder. */
  feedCount: number;
  /** Unread articles across this folder and its subfolders. */
  unread: number;
  children: FolderNode[];
}

export interface TagSummary {
  id: number;
  name: string;
  feedCount: number;
  unread: number;
}

/** All folders with rolled-up counts, assembled into a two-level tree. */
export async function listFolders(): Promise<FolderNode[]> {
  const db = await getDb();

  const folderRows = toRows<{
    id: number;
    name: string;
    parent_id: number | null;
    sort_order: number;
  }>(
    await db.execute(sql`
      SELECT id, name, parent_id, sort_order
      FROM folders
      ORDER BY sort_order, name
    `),
  );

  const feedRows = toRows<{ folder_id: number | null; feed_count: number; unread: number }>(
    await db.execute(sql`
      SELECT
        f.folder_id,
        count(DISTINCT f.id)::int AS feed_count,
        count(a.id) FILTER (WHERE a.is_read = false)::int AS unread
      FROM feeds f
      LEFT JOIN articles a ON a.feed_id = f.id
      GROUP BY f.folder_id
    `),
  );

  const direct = new Map<number, { feedCount: number; unread: number }>();
  for (const row of feedRows) {
    if (row.folder_id === null) continue;
    direct.set(Number(row.folder_id), {
      feedCount: Number(row.feed_count),
      unread: Number(row.unread),
    });
  }

  const nodes = new Map<number, FolderNode>();
  for (const row of folderRows) {
    const id = Number(row.id);
    const stats = direct.get(id) ?? { feedCount: 0, unread: 0 };
    nodes.set(id, {
      id,
      name: row.name,
      parentId: row.parent_id === null ? null : Number(row.parent_id),
      sortOrder: Number(row.sort_order),
      feedCount: stats.feedCount,
      unread: stats.unread,
      children: [],
    });
  }

  const roots: FolderNode[] = [];
  for (const node of nodes.values()) {
    if (node.parentId !== null && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node);
    } else {
      // Orphans (parent deleted out from under it) surface at the top level
      // rather than disappearing.
      roots.push(node);
    }
  }

  // A parent's unread count includes its subfolders, so collapsing a folder
  // still shows everything unread inside it.
  for (const node of nodes.values()) {
    if (node.children.length > 0) {
      node.unread += node.children.reduce((sum, child) => sum + child.unread, 0);
      node.feedCount += node.children.reduce((sum, child) => sum + child.feedCount, 0);
    }
  }

  return roots;
}

/** Tags with usage counts, for the filter strip. */
export async function listTags(): Promise<TagSummary[]> {
  const db = await getDb();

  const result = await db.execute(sql`
    SELECT
      t.id,
      t.name,
      count(DISTINCT ft.feed_id)::int AS feed_count,
      count(a.id) FILTER (WHERE a.is_read = false)::int AS unread
    FROM tags t
    LEFT JOIN feed_tags ft ON ft.tag_id = t.id
    LEFT JOIN articles a ON a.feed_id = ft.feed_id
    GROUP BY t.id, t.name
    ORDER BY t.name
  `);

  return toRows<{ id: number; name: string; feed_count: number; unread: number }>(result).map(
    (row) => ({
      id: Number(row.id),
      name: row.name,
      feedCount: Number(row.feed_count),
      unread: Number(row.unread),
    }),
  );
}

/** Tag id -> names, used to label feeds in the sidebar and settings. */
export async function getFeedTagMap(): Promise<Record<number, Array<{ id: number; name: string }>>> {
  const db = await getDb();
  const result = await db.execute(sql`
    SELECT ft.feed_id, t.id AS tag_id, t.name
    FROM feed_tags ft
    JOIN tags t ON t.id = ft.tag_id
    ORDER BY t.name
  `);

  const map: Record<number, Array<{ id: number; name: string }>> = {};
  for (const row of toRows<{ feed_id: number; tag_id: number; name: string }>(result)) {
    const feedId = Number(row.feed_id);
    (map[feedId] ??= []).push({ id: Number(row.tag_id), name: row.name });
  }
  return map;
}

// --- folders ---------------------------------------------------------------

export async function createFolder(name: string, parentId: number | null) {
  const db = await getDb();
  const inserted = await db.execute(sql`
    INSERT INTO folders (name, parent_id)
    VALUES (${name}, ${parentId})
    RETURNING id, name, parent_id, sort_order
  `);
  return toRows<{ id: number; name: string; parent_id: number | null; sort_order: number }>(
    inserted,
  )[0];
}

export async function folderExists(id: number): Promise<boolean> {
  const db = await getDb();
  const rows = toRows<{ id: number }>(
    await db.execute(sql`SELECT id FROM folders WHERE id = ${id} LIMIT 1`),
  );
  return rows.length > 0;
}

/**
 * Whether a folder of this name already exists at the given level.
 * Checked up front so the API can return a clean 409 instead of relying on
 * parsing a constraint-violation error out of the driver.
 */
export async function folderNameExists(
  name: string,
  parentId: number | null,
  excludeId?: number,
): Promise<boolean> {
  const db = await getDb();
  const rows = toRows<{ id: number }>(
    await db.execute(sql`
      SELECT id FROM folders
      WHERE name = ${name}
        AND coalesce(parent_id, 0) = coalesce(${parentId}, 0)
        ${excludeId !== undefined ? sql`AND id <> ${excludeId}` : sql``}
      LIMIT 1
    `),
  );
  return rows.length > 0;
}

export async function getFolderParentId(id: number): Promise<number | null | undefined> {
  const db = await getDb();
  const rows = toRows<{ parent_id: number | null }>(
    await db.execute(sql`SELECT parent_id FROM folders WHERE id = ${id} LIMIT 1`),
  );
  if (rows.length === 0) return undefined;
  return rows[0].parent_id === null ? null : Number(rows[0].parent_id);
}

/**
 * True when an error is a Postgres unique-constraint violation (SQLSTATE
 * 23505). Walks the `cause` chain because Drizzle wraps driver errors.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const candidate = current as { code?: unknown; sqlState?: unknown; cause?: unknown };
    const state = candidate.code ?? candidate.sqlState;
    if (state === '23505') return true;
    current = candidate.cause;
  }
  return false;
}

export async function renameFolder(id: number, name: string) {
  const db = await getDb();
  await db.execute(sql`UPDATE folders SET name = ${name} WHERE id = ${id}`);
}

/**
 * Deletes a folder. Subfolders cascade away (their feeds are promoted to the
 * top level by the ON DELETE SET NULL foreign key rather than being deleted),
 * and the parent's direct feeds are moved up a level first so nothing is lost.
 */
export async function deleteFolder(id: number) {
  const db = await getDb();
  await db.execute(sql`
    UPDATE feeds
    SET folder_id = (SELECT parent_id FROM folders WHERE id = ${id})
    WHERE folder_id = ${id}
  `);
  await db.execute(sql`DELETE FROM folders WHERE id = ${id}`);
}

// --- tags ------------------------------------------------------------------

/** Creates tags on demand and returns their ids, including already-existing ones. */
export async function upsertTags(names: string[]): Promise<number[]> {
  const cleaned = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (cleaned.length === 0) return [];

  const db = await getDb();
  const ids: number[] = [];

  for (const name of cleaned) {
    const result = await db.execute(sql`
      INSERT INTO tags (name) VALUES (${name})
      ON CONFLICT (name) DO UPDATE SET name = excluded.name
      RETURNING id
    `);
    const row = toRows<{ id: number }>(result)[0];
    if (row) ids.push(Number(row.id));
  }

  return ids;
}

/** Replaces a feed's tags wholesale. Returns the resulting tag names. */
export async function setFeedTags(feedId: number, names: string[]): Promise<string[]> {
  const db = await getDb();
  const ids = await upsertTags(names);

  // Clear then re-add: simplest correct behaviour for a wholesale replace.
  await db.execute(sql`DELETE FROM feed_tags WHERE feed_id = ${feedId}`);
  for (const tagId of ids) {
    await db.execute(sql`
      INSERT INTO feed_tags (feed_id, tag_id) VALUES (${feedId}, ${tagId})
      ON CONFLICT DO NOTHING
    `);
  }

  // Drop tags that are no longer attached to anything, so the filter strip
  // does not accumulate orphans.
  await db.execute(sql`DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM feed_tags)`);

  const remaining = toRows<{ name: string }>(
    await db.execute(sql`
      SELECT t.name FROM feed_tags ft
      JOIN tags t ON t.id = ft.tag_id
      WHERE ft.feed_id = ${feedId}
      ORDER BY t.name
    `),
  );
  return remaining.map((row) => row.name);
}

export async function renameTag(id: number, name: string) {
  const db = await getDb();
  // A rename onto an existing name would violate the unique index; merge instead.
  const existing = toRows<{ id: number }>(
    await db.execute(sql`SELECT id FROM tags WHERE name = ${name} AND id <> ${id} LIMIT 1`),
  );

  if (existing.length > 0) {
    const targetId = Number(existing[0].id);
    await db.execute(sql`
      INSERT INTO feed_tags (feed_id, tag_id)
      SELECT feed_id, ${targetId} FROM feed_tags WHERE tag_id = ${id}
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`DELETE FROM tags WHERE id = ${id}`);
    return targetId;
  }

  await db.execute(sql`UPDATE tags SET name = ${name} WHERE id = ${id}`);
  return id;
}

export async function deleteTag(id: number) {
  const db = await getDb();
  // feed_tags rows cascade.
  await db.execute(sql`DELETE FROM tags WHERE id = ${id}`);
}

export async function tagExists(id: number): Promise<boolean> {
  const db = await getDb();
  const rows = toRows<{ id: number }>(
    await db.execute(sql`SELECT id FROM tags WHERE id = ${id} LIMIT 1`),
  );
  return rows.length > 0;
}

/** SQL predicate matching articles whose feed is in a folder (or its children). */
export function folderArticleFilter(folderId: number): SQL {
  return sql`EXISTS (
    SELECT 1 FROM feeds f
    WHERE f.id = a.feed_id
      AND (f.folder_id = ${folderId}
           OR f.folder_id IN (SELECT id FROM folders WHERE parent_id = ${folderId}))
  )`;
}

/** SQL predicate matching articles whose feed carries a tag. */
export function tagArticleFilter(tagId: number): SQL {
  return sql`EXISTS (
    SELECT 1 FROM feed_tags ft
    WHERE ft.feed_id = a.feed_id AND ft.tag_id = ${tagId}
  )`;
}
