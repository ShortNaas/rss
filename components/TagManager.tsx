'use client';

import { useEffect, useState } from 'react';
import type { TagSummary } from '@/lib/types';

export interface TagManagerProps {
  tags: TagSummary[];
  onClose: () => void;
  onRename: (tagId: number, name: string) => Promise<void>;
  onDelete: (tag: TagSummary) => Promise<void>;
}

/**
 * Rename or delete tags across all feeds. A rename onto an existing name merges
 * the two, which the API reports back.
 */
export function TagManager({ tags, onClose, onRename, onDelete }: TagManagerProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && editingId === null) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editingId, onClose]);

  async function commit(tag: TagSummary) {
    const name = draft.trim();
    setEditingId(null);
    if (!name || name === tag.name) return;

    setBusyId(tag.id);
    try {
      await onRename(tag.id, name);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Manage tags"
        className="w-full max-w-md space-y-3 rounded-xl border app-border app-panel p-5 shadow-xl dark:app-border dark:app-muted"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold">Manage tags</h2>
            <p className="mt-0.5 text-xs app-text-muted dark:app-text-muted">
              Renaming a tag onto an existing name merges them.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded px-2 py-0.5 app-text-muted hover:app-muted dark:hover:app-muted"
          >
            ✕
          </button>
        </div>

        {tags.length === 0 ? (
          <p className="py-6 text-center text-sm app-text-muted dark:app-text-muted">
            No tags yet. Add tags from a feed&rsquo;s settings.
          </p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {tags.map((tag) => (
              <li
                key={tag.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:app-bg dark:hover:app-muted/60"
              >
                {editingId === tag.id ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void commit(tag);
                      if (event.key === 'Escape') setEditingId(null);
                    }}
                    onBlur={() => void commit(tag)}
                    maxLength={60}
                    className="min-w-0 flex-1 rounded border app-border app-panel px-2 py-1 text-sm outline-none focus:border-blue-500 dark:app-border dark:app-bg dark:app-text"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(tag.id);
                      setDraft(tag.name);
                    }}
                    className="min-w-0 flex-1 truncate text-left text-sm"
                    title="Click to rename"
                  >
                    {tag.name}
                  </button>
                )}

                <span className="shrink-0 text-xs app-text-muted">
                  {tag.feedCount} feed{tag.feedCount === 1 ? '' : 's'}
                </span>

                <button
                  type="button"
                  onClick={() => void onDelete(tag)}
                  disabled={busyId === tag.id}
                  title={`Delete tag ${tag.name}`}
                  className="shrink-0 rounded px-1.5 py-0.5 text-xs app-text-muted hover:bg-red-100 hover:text-red-700 disabled:opacity-50 dark:hover:bg-red-950 dark:hover:text-red-300"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
