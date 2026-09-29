'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FeedSummary, FolderNode } from '@/lib/types';

export interface FeedSettingsProps {
  feed: FeedSummary;
  folders: FolderNode[];
  /** All tag names in use, for suggestions. */
  knownTags: string[];
  onClose: () => void;
  onSave: (changes: {
    title: string | null;
    folderId: number | null;
    tags: string[];
  }) => Promise<void>;
}

function flattenFolders(folders: FolderNode[], depth = 0): Array<{ id: number; label: string }> {
  const out: Array<{ id: number; label: string }> = [];
  for (const folder of folders) {
    out.push({ id: folder.id, label: `${'— '.repeat(depth)}${folder.name}` });
    out.push(...flattenFolders(folder.children, depth + 1));
  }
  return out;
}

/**
 * Per-feed settings: rename, move between folders, and edit tags.
 * Tags are entered as free text with suggestions from tags already in use.
 */
export function FeedSettings({
  feed,
  folders,
  knownTags,
  onClose,
  onSave,
}: FeedSettingsProps) {
  const [title, setTitle] = useState(feed.title ?? '');
  const [folderId, setFolderId] = useState<number | null>(feed.folderId);
  const [tags, setTags] = useState<string[]>(feed.tags.map((tag) => tag.name));
  const [tagDraft, setTagDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);

  const folderOptions = useMemo(() => flattenFolders(folders), [folders]);

  const suggestions = useMemo(() => {
    const lower = tagDraft.trim().toLowerCase();
    return knownTags
      .filter((tag) => !tags.some((existing) => existing.toLowerCase() === tag.toLowerCase()))
      .filter((tag) => (lower ? tag.toLowerCase().includes(lower) : true))
      .slice(0, 6);
  }, [knownTags, tagDraft, tags]);

  // Escape closes; focus moves into the dialog on open.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function addTag(name: string) {
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) return;
    if (tags.some((tag) => tag.toLowerCase() === trimmed.toLowerCase())) {
      setTagDraft('');
      return;
    }
    setTags((previous) => [...previous, trimmed]);
    setTagDraft('');
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave({
        title: title.trim() || null,
        folderId,
        tags,
      });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save changes');
      setBusy(false);
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
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Settings for ${feed.title ?? feed.url}`}
        className="w-full max-w-lg space-y-4 rounded-xl border app-border app-panel p-5 shadow-xl outline-none dark:app-border dark:app-muted"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Feed settings</h2>
            <p className="mt-0.5 truncate text-xs app-text-muted dark:app-text-muted">
              {feed.url}
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

        <label className="block">
          <span className="mb-1 block text-xs font-medium app-text-muted dark:app-text">
            Title
          </span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={500}
            placeholder={feed.url}
            className="w-full rounded-md border app-border app-panel px-3 py-1.5 text-sm outline-none focus:border-blue-500 dark:app-border dark:app-bg dark:app-text"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium app-text-muted dark:app-text">
            Folder
          </span>
          <select
            value={folderId ?? ''}
            onChange={(event) =>
              setFolderId(event.target.value === '' ? null : Number(event.target.value))
            }
            className="w-full rounded-md border app-border app-panel px-3 py-1.5 text-sm dark:app-border dark:app-bg dark:app-text"
          >
            <option value="">No folder (top level)</option>
            {folderOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div>
          <span className="mb-1 block text-xs font-medium app-text-muted dark:app-text">
            Tags
          </span>

          {tags.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full app-muted px-2 py-0.5 text-xs app-text dark:app-active dark:app-text"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => setTags((previous) => previous.filter((t) => t !== tag))}
                    aria-label={`Remove tag ${tag}`}
                    className="app-text-muted hover:text-red-600 dark:hover:text-red-400"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              value={tagDraft}
              onChange={(event) => setTagDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ',') {
                  event.preventDefault();
                  addTag(tagDraft);
                } else if (event.key === 'Backspace' && !tagDraft && tags.length > 0) {
                  setTags((previous) => previous.slice(0, -1));
                }
              }}
              placeholder="Add a tag and press Enter"
              maxLength={60}
              className="min-w-0 flex-1 rounded-md border app-border app-panel px-3 py-1.5 text-sm outline-none focus:border-blue-500 dark:app-border dark:app-bg dark:app-text"
            />
            <button
              type="button"
              onClick={() => addTag(tagDraft)}
              disabled={!tagDraft.trim()}
              className="rounded-md border app-border px-3 py-1.5 text-sm transition hover:app-muted disabled:opacity-50 dark:app-border dark:hover:app-muted"
            >
              Add
            </button>
          </div>

          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestions.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => addTag(tag)}
                  className="rounded-full border border-dashed app-border px-2 py-0.5 text-xs app-text-muted transition hover:border-blue-500 hover:text-blue-700 dark:app-border dark:app-text-muted dark:hover:text-blue-400"
                >
                  + {tag}
                </button>
              ))}
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t app-border pt-4 dark:app-border">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border app-border px-3 py-1.5 text-sm transition hover:app-muted dark:app-border dark:hover:app-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
