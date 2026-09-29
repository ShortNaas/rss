'use client';

import { ArticleItem } from './ArticleItem';
import type { ArticleSummary } from '@/lib/types';

interface ArticleListProps {
  articles: ArticleSummary[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  total: number;
  query: string | null;
  onOpen: (article: ArticleSummary) => void;
  onToggleRead: (article: ArticleSummary, isRead: boolean) => void;
  onOpenOriginal: (article: ArticleSummary) => void;
  onLoadMore: () => void;
}

export function ArticleList({
  articles,
  loading,
  loadingMore,
  hasMore,
  total,
  query,
  onOpen,
  onToggleRead,
  onOpenOriginal,
  onLoadMore,
}: ArticleListProps) {
  if (loading && articles.length === 0) {
    return (
      <div className="p-8 text-center text-sm app-text-muted dark:app-text-muted">
        Loading articles…
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <div className="p-10 text-center text-sm app-text-muted dark:app-text-muted">
        {query ? (
          <>
            <p>No articles match “{query}”.</p>
            <p className="mt-2 text-xs">Full-text search covers titles and article bodies.</p>
          </>
        ) : (
          <>
            <p>Nothing here yet.</p>
            <p className="mt-2 text-xs">
              Add a feed, or press Refresh to fetch the latest articles.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between border-b app-border px-4 py-2 text-xs app-text-muted dark:app-border dark:app-text-muted">
        <span>
          {articles.length} of {total} article{total === 1 ? '' : 's'}
          {query ? ` matching “${query}”` : ''}
        </span>
        {loading && <span>Updating…</span>}
      </div>

      {articles.map((article) => (
        <ArticleItem
          key={article.id}
          article={article}
          onOpen={onOpen}
          onToggleRead={onToggleRead}
          onOpenOriginal={onOpenOriginal}
        />
      ))}

      {hasMore && (
        <div className="p-4 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="rounded-md border app-border px-4 py-2 text-sm app-text transition hover:app-muted disabled:opacity-60 dark:app-border dark:app-text dark:hover:app-muted"
          >
            {loadingMore ? 'Loading…' : `Load more (${total - articles.length} remaining)`}
          </button>
        </div>
      )}
    </div>
  );
}
