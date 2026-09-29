'use client';

import { absoluteTime, relativeTime } from '@/lib/api';
import type { ArticleSummary } from '@/lib/types';

interface ArticleItemProps {
  article: ArticleSummary;
  onOpen: (article: ArticleSummary) => void;
  onToggleRead: (article: ArticleSummary, isRead: boolean) => void;
  onOpenOriginal: (article: ArticleSummary) => void;
}

export function ArticleItem({
  article,
  onOpen,
  onToggleRead,
  onOpenOriginal,
}: ArticleItemProps) {
  return (
    <article
      className={`group border-b app-border px-4 py-3 transition dark:app-border hover:app-bg dark:hover:app-muted ${
        article.isRead ? 'opacity-70' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={article.isRead}
          onChange={(event) => onToggleRead(article, event.target.checked)}
          title={article.isRead ? 'Mark as unread' : 'Mark as read'}
          aria-label={article.isRead ? 'Mark as unread' : 'Mark as read'}
          className="mt-1.5 h-4 w-4 shrink-0 cursor-pointer accent-blue-600"
        />

        <div className="min-w-0 flex-1">
          {/* The whole title opens the distraction-free reader. */}
          <button
            type="button"
            id={`article-title-${article.id}`}
            onClick={() => onOpen(article)}
            className="block w-full text-left"
            title="Open in reader"
          >
            <h3
              className={`text-[0.95rem] leading-6 transition group-hover:text-blue-700 dark:group-hover:text-blue-400 ${
                article.isRead
                  ? 'font-normal app-text-muted dark:app-text-muted'
                  : 'font-semibold app-text dark:app-text'
              }`}
            >
              {article.title ?? '(untitled)'}
            </h3>
          </button>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs app-text-muted dark:app-text-muted">
            <span className="font-medium app-text-muted dark:app-text">
              {article.feedTitle ?? 'Unknown feed'}
            </span>
            {article.publishedAt && (
              <>
                <span aria-hidden>·</span>
                <time dateTime={article.publishedAt} title={absoluteTime(article.publishedAt)}>
                  {relativeTime(article.publishedAt)}
                </time>
              </>
            )}
            {article.author && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{article.author}</span>
              </>
            )}
          </div>

          {article.summary && (
            <p className="line-clamp-2 mt-1.5 text-sm app-text-muted dark:app-text-muted">
              {article.summary}
            </p>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onOpen(article)}
              className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-blue-700"
            >
              Read
            </button>
            {article.link && (
              <button
                type="button"
                onClick={() => onOpenOriginal(article)}
                className="rounded-md border app-border px-2.5 py-1 text-xs app-text transition hover:app-muted dark:app-border dark:app-text dark:hover:app-muted"
              >
                Source ↗
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
