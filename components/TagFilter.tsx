'use client';

import type { TagSummary } from '@/lib/types';

export interface TagFilterProps {
  tags: TagSummary[];
  selectedTagId: number | null;
  onSelectTag: (tagId: number | null) => void;
  onManage: () => void;
}

/** Cross-cutting tag filter strip. Tags span folders, so this is separate. */
export function TagFilter({ tags, selectedTagId, onSelectTag, onManage }: TagFilterProps) {
  if (tags.length === 0) {
    return (
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide app-text-muted dark:app-text-muted">
          Tags
        </h2>
        <button
          type="button"
          onClick={onManage}
          className="rounded px-1.5 text-xs app-text-muted transition hover:app-muted hover:app-text dark:hover:app-muted dark:hover:app-text"
        >
          Manage
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide app-text-muted dark:app-text-muted">
          Tags
        </h2>
        <button
          type="button"
          onClick={onManage}
          className="rounded px-1.5 text-xs app-text-muted transition hover:app-muted hover:app-text dark:hover:app-muted dark:hover:app-text"
        >
          Manage
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 px-1">
        {tags.map((tag) => {
          const active = tag.id === selectedTagId;
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => onSelectTag(active ? null : tag.id)}
              aria-pressed={active}
              title={`${tag.feedCount} feed${tag.feedCount === 1 ? '' : 's'} · ${tag.unread} unread`}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
                active
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'app-border app-text-muted hover:app-muted dark:app-border dark:app-text dark:hover:app-muted'
              }`}
            >
              <span className="max-w-[9rem] truncate">{tag.name}</span>
              {tag.unread > 0 && (
                <span
                  className={`rounded-full px-1 text-[10px] font-semibold ${
                    active ? 'app-panel/25' : 'bg-blue-600 text-white'
                  }`}
                >
                  {tag.unread > 99 ? '99+' : tag.unread}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
