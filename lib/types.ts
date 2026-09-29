/** Shapes returned by the route handlers, shared by the client components. */

export interface FeedTag {
  id: number;
  name: string;
}

export interface FeedSummary {
  id: number;
  url: string;
  title: string | null;
  siteUrl: string | null;
  description: string | null;
  folderId: number | null;
  tags: FeedTag[];
  lastFetchedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  errorCount: number;
  createdAt: string;
  unread: number;
}

export interface FolderNode {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder: number;
  feedCount: number;
  unread: number;
  children: FolderNode[];
}

export interface TagSummary {
  id: number;
  name: string;
  feedCount: number;
  unread: number;
}

export interface FeedsResponse {
  feeds: FeedSummary[];
  folders: FolderNode[];
  tags: TagSummary[];
  totalUnread: number;
}

export interface ArticleSummary {
  id: number;
  feedId: number;
  feedTitle: string | null;
  feedSiteUrl: string | null;
  title: string | null;
  link: string | null;
  author: string | null;
  summary: string | null;
  content: string | null;
  publishedAt: string | null;
  isRead: boolean;
  /** True when `content` is extracted full text rather than the feed's own body. */
  isExtracted?: boolean;
  extractedAt?: string | null;
  /** Last extraction failure for this article, if any. */
  extractionError?: string | null;
}

export interface ArticlesResponse {
  articles: ArticleSummary[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  query: string | null;
}

export interface FeedRefreshResult {
  feedId: number;
  url: string;
  title: string | null;
  status: 'ok' | 'unchanged' | 'error' | 'skipped';
  inserted?: number;
  updated?: number;
  itemCount?: number;
  format?: string;
  ms: number;
  error?: string;
}

export interface RefreshReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  total: number;
  succeeded: number;
  unchanged: number;
  failed: number;
  skipped: number;
  inserted: number;
  updated: number;
  results: FeedRefreshResult[];
}

export interface OpmlImportSummary {
  found: number;
  truncated?: boolean;
  imported: number;
  duplicates: number;
  invalid: number;
  fetched: { inserted: number; failed: number; skipped: number } | null;
  outcomes: Array<{
    url: string;
    title: string | null;
    status: 'added' | 'duplicate' | 'invalid';
    detail?: string;
  }>;
}
