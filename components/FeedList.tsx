'use client';

import type { FeedSummary } from '@/lib/types';

interface FeedListProps {
  feeds: FeedSummary[];
  selectedFeedId: number | null;
  onSelectFeed: (feedId: number | null) => void;
  onOpenSettings: (feed: FeedSummary) => void;
  onDeleteFeed: (feed: FeedSummary) => void;
  onRefreshFeed: (feed: FeedSummary) => void;
  onImportClick: () => void;
  onExportClick: () => void;
  opmlBusy: boolean;
  /** Feed ids whose folder is currently selected; used to show a section. */
  sectionLabel?: string | null;
}

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto shrink-0 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">
      {count > 999 ? '999+' : count}
    </span>
  );
}

export function FeedList({
  feeds,
  selectedFeedId,
  onSelectFeed,
  onOpenSettings,
  onDeleteFeed,
  onRefreshFeed,
  onImportClick,
  onExportClick,
  opmlBusy,
  sectionLabel,
}: FeedListProps) {
  const rowBase = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition';

  return (
    <div className="flex h-full flex-col gap-1">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide app-text-muted dark:app-text-muted">
        {sectionLabel ?? 'Feeds'}
      </h2>

      {feeds.length === 0 ? (
        <p className="px-2 py-1 text-xs app-text-muted dark:app-text-muted">
          No feeds here yet.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-0.5">
          {feeds.map((feed) => {
            const active = feed.id === selectedFeedId;
            return (
              <li key={feed.id} className="group">
                <div
                  className={`${rowBase} ${
                    active
                      ? 'app-active app-active-text dark:app-active dark:text-blue-300'
                      : 'app-text hover:app-muted dark:app-text dark:hover:app-muted'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectFeed(active ? null : feed.id)}
                    className="min-w-0 flex-1 truncate text-left"
                    title={feed.title ?? feed.url}
                  >
                    {feed.title ?? feed.url}
                  </button>

                  {feed.lastError && (
                    <span
                      className="shrink-0 text-amber-600 dark:text-amber-400"
                      title={`Last refresh failed: ${feed.lastError}`}
                      aria-label="This feed is failing"
                    >
                      ⚠
                    </span>
                  )}

                  <UnreadBadge count={feed.unread} />

                  <span className="hidden shrink-0 gap-1 group-hover:flex focus-within:flex">
                    <button
                      type="button"
                      onClick={() => onRefreshFeed(feed)}
                      title={`Refresh ${feed.title ?? feed.url}`}
                      className="rounded px-1 text-xs app-text-muted hover:app-muted hover:app-text dark:hover:app-muted dark:hover:app-text"
                    >
                      ↻
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenSettings(feed)}
                      title={`Settings for ${feed.title ?? feed.url}`}
                      className="rounded px-1 text-xs app-text-muted hover:app-muted hover:app-text dark:hover:app-muted dark:hover:app-text"
                    >
                      ⚙
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteFeed(feed)}
                      title={`Remove ${feed.title ?? feed.url}`}
                      className="rounded px-1 text-xs app-text-muted hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-950 dark:hover:text-red-300"
                    >
                      ✕
                    </button>
                  </span>
                </div>

                {feed.tags.length > 0 && (
                  <div className="mb-1 ml-3 flex flex-wrap gap-1 py-0.5">
                    {/* Labels only; the tag filter strip handles filtering. */}
                    {feed.tags.map((tag) => (
                      <span
                        key={tag.id}
                        className="rounded-full border app-border px-1.5 text-[10px] app-text-muted dark:app-border dark:app-text-muted"
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-2 flex gap-2 border-t app-border pt-3 dark:app-border">
        <button
          type="button"
          onClick={onImportClick}
          disabled={opmlBusy}
          className="flex-1 rounded-md border app-border px-2 py-1.5 text-xs app-text transition hover:app-muted disabled:opacity-60 dark:app-border dark:app-text dark:hover:app-muted"
        >
          Import OPML
        </button>
        <button
          type="button"
          onClick={onExportClick}
          className="flex-1 rounded-md border app-border px-2 py-1.5 text-xs app-text transition hover:app-muted dark:app-border dark:app-text dark:hover:app-muted"
        >
          Export OPML
        </button>
      </div>
    </div>
  );
}
