import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/**
 * Feeds can be grouped into folders. Folders nest exactly one level: a folder
 * with a parent is a subfolder, and a subfolder may not itself have children
 * (enforced in the API, which keeps the sidebar a predictable two-level tree).
 */
export const folders = pgTable(
  'folders',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    parentId: integer('parent_id').references((): AnyPgColumn => folders.id, {
      onDelete: 'cascade',
    }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Two sibling folders cannot share a name, but the same name may appear
    // under different parents. NULL parents need the coalesce to be indexable.
    uniqueIndex('folders_parent_name_key').on(
      sql`coalesce(${table.parentId}, 0)`,
      table.name,
    ),
  ],
);

export const feeds = pgTable(
  'feeds',
  {
    id: serial('id').primaryKey(),
    url: text('url').notNull().unique(),
    title: text('title'),
    siteUrl: text('site_url'),
    description: text('description'),

    /** NULL means the feed sits at the top level, outside any folder. */
    folderId: integer('folder_id').references(() => folders.id, { onDelete: 'set null' }),

    // Conditional GET (ETag / Last-Modified) so unchanged feeds cost ~0 bytes.
    etag: text('etag'),
    lastModified: text('last_modified'),

    // Set only on a successful fetch.
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
    // Populated on failure so broken feeds are visible in the UI instead of silent.
    lastError: text('last_error'),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
    // Consecutive failures, used to surface persistently broken feeds.
    errorCount: integer('error_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('feeds_folder_idx').on(table.folderId)],
);

/**
 * Tags are cross-cutting labels: a feed can carry many, and a tag spans feeds
 * in different folders. Deliberately separate from folders so "read later" or
 * "newsletter" can cut across the folder hierarchy.
 */
export const tags = pgTable('tags', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const feedTags = pgTable(
  'feed_tags',
  {
    feedId: integer('feed_id')
      .notNull()
      .references(() => feeds.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    // Composite PK is what makes assigning a tag idempotent.
    primaryKey({ columns: [table.feedId, table.tagId] }),
    index('feed_tags_tag_idx').on(table.tagId),
  ],
);

export const articles = pgTable(
  'articles',
  {
    id: serial('id').primaryKey(),
    feedId: integer('feed_id')
      .notNull()
      .references(() => feeds.id, { onDelete: 'cascade' }),

    /** Dedup key: item guid, else link, else a hash of title+date. */
    guid: text('guid').notNull(),
    title: text('title'),
    link: text('link'),
    author: text('author'),
    /** Sanitized HTML, ready to render. */
    content: text('content'),
    /** Plain text, used for snippets. */
    summary: text('summary'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /**
     * Full article body pulled from the source page by Readability, for feeds
     * that publish only a teaser. Null until extraction has run.
     */
    extractedContent: text('extracted_content'),
    extractedAt: timestamp('extracted_at', { withTimezone: true }),
    /** Author as reported by the source page, when the feed did not name one. */
    extractedByline: text('extracted_byline'),
    /** Last extraction failure, shown in the reader so failures are not silent. */
    extractionError: text('extraction_error'),

    isRead: boolean('is_read').notNull().default(false),
    readAt: timestamp('read_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // This is what makes `onConflictDoNothing` / `onConflictDoUpdate` work.
    uniqueIndex('articles_feed_id_guid_key').on(table.feedId, table.guid),
    index('articles_feed_published_idx').on(table.feedId, table.publishedAt.desc()),
    // Partial index: unread is the hot filter, and unread rows are the minority.
    index('articles_unread_idx')
      .on(table.publishedAt.desc())
      .where(sql`${table.isRead} = false`),
    index('articles_published_idx').on(table.publishedAt.desc()),
  ],
);

/**
 * The full-text search vector is maintained as a real `tsvector` column with a
 * GIN index, created in a hand-written migration
 * (drizzle/0001_full_text_search.sql) because drizzle-kit cannot express
 * `tsvector` column types or GIN indexes.
 */
export const SEARCH_VECTOR_COLUMN = 'search_vector';

export type Feed = typeof feeds.$inferSelect;
export type Article = typeof articles.$inferSelect;
export type Folder = typeof folders.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type NewFeed = typeof feeds.$inferInsert;
export type NewArticle = typeof articles.$inferInsert;
export type NewFolder = typeof folders.$inferInsert;
export type NewTag = typeof tags.$inferInsert;
