'use client';

import { useState } from 'react';
import type { FeedSummary, FolderNode } from '@/lib/types';

export interface FolderTreeProps {
  folders: FolderNode[];
  feeds: FeedSummary[];
  /** null selects the top level (feeds with no folder). */
  selectedFolderId: number | null | undefined;
  onSelectFolder: (folderId: number | null) => void;
  onCreateFolder: (name: string, parentId: number | null) => Promise<void>;
  onRenameFolder: (folderId: number, name: string) => Promise<void>;
  onDeleteFolder: (folder: FolderNode) => Promise<void>;
}

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto shrink-0 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">
      {count > 999 ? '999+' : count}
    </span>
  );
}

export function FolderTree({
  folders,
  feeds,
  selectedFolderId,
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: FolderTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState<{ parentId: number | null } | null>(null);
  const [draftName, setDraftName] = useState('');
  const [busy, setBusy] = useState(false);

  const unfiledCount = feeds.filter((feed) => feed.folderId === null).length;

  async function submitNewFolder(event: React.FormEvent) {
    event.preventDefault();
    const name = draftName.trim();
    if (!name || !adding || busy) return;

    setBusy(true);
    try {
      await onCreateFolder(name, adding.parentId);
      setDraftName('');
      setAdding(null);
    } finally {
      setBusy(false);
    }
  }

  async function promptRename(folder: FolderNode) {
    const next = window.prompt(`Rename folder “${folder.name}” to:`, folder.name);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === folder.name) return;
    await onRenameFolder(folder.id, trimmed);
  }

  function toggle(folderId: number) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  return (
    <div className="space-y-0.5">
      <div className="mb-1 flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide app-text-muted dark:app-text-muted">
          Folders
        </h2>
        <button
          type="button"
          onClick={() => {
            setAdding({ parentId: null });
            setDraftName('');
          }}
          title="New folder"
          className="rounded px-1.5 text-sm app-text-muted transition hover:app-muted hover:app-text dark:hover:app-muted dark:hover:app-text"
        >
          + New
        </button>
      </div>

      {adding && adding.parentId === null && (
        <form onSubmit={submitNewFolder} className="flex gap-1 px-1 pb-1">
          <input
            autoFocus
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setAdding(null);
                setDraftName('');
              }
            }}
            placeholder="Folder name"
            maxLength={100}
            className="min-w-0 flex-1 rounded border app-border app-panel px-2 py-1 text-sm outline-none focus:border-blue-500 dark:app-border dark:app-muted dark:app-text"
          />
          <button
            type="submit"
            disabled={busy || !draftName.trim()}
            className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-60"
          >
            Add
          </button>
        </form>
      )}

      <ul className="space-y-0.5">
        {folders.map((folder) => {
          const expanded = !collapsed.has(folder.id);
          return (
            <li key={folder.id}>
              <div
                className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition ${
                  selectedFolderId === folder.id
                    ? 'app-active font-medium app-active-text dark:app-active dark:text-blue-300'
                    : 'app-text hover:app-muted dark:app-text dark:hover:app-muted'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggle(folder.id)}
                  aria-expanded={expanded}
                  aria-label={expanded ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
                  className={`w-3 shrink-0 text-xs app-text-muted transition-transform ${
                    folder.children.length > 0 ? '' : 'pointer-events-none opacity-0'
                  } ${expanded ? 'rotate-90' : ''}`}
                >
                  ▸
                </button>

                <button
                  type="button"
                  onClick={() => onSelectFolder(folder.id)}
                  className="min-w-0 flex-1 truncate text-left"
                  title={folder.name}
                >
                  {folder.name}
                </button>

                <UnreadBadge count={folder.unread} />

                <span className="hidden shrink-0 gap-0.5 group-hover:flex focus-within:flex">
                  <button
                    type="button"
                    onClick={() => {
                      setAdding({ parentId: folder.id });
                      setDraftName('');
                    }}
                    title={`New subfolder in ${folder.name}`}
                    className="rounded px-1 text-xs app-text-muted hover:app-muted hover:app-text dark:hover:app-muted dark:hover:app-text"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => void promptRename(folder)}
                    title={`Rename ${folder.name}`}
                    className="rounded px-1 text-xs app-text-muted hover:app-muted hover:app-text dark:hover:app-muted dark:hover:app-text"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDeleteFolder(folder)}
                    title={`Delete ${folder.name}`}
                    className="rounded px-1 text-xs app-text-muted hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-950 dark:hover:text-red-300"
                  >
                    ✕
                  </button>
                </span>
              </div>

              {adding && adding.parentId === folder.id && (
                <form onSubmit={submitNewFolder} className="flex gap-1 py-1 pl-6 pr-1">
                  <input
                    autoFocus
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setAdding(null);
                        setDraftName('');
                      }
                    }}
                    placeholder="Subfolder name"
                    maxLength={100}
                    className="min-w-0 flex-1 rounded border app-border app-panel px-2 py-1 text-sm outline-none focus:border-blue-500 dark:app-border dark:app-muted dark:app-text"
                  />
                  <button
                    type="submit"
                    disabled={busy || !draftName.trim()}
                    className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-60"
                  >
                    Add
                  </button>
                </form>
              )}

              {expanded && folder.children.length > 0 && (
                <ul className="space-y-0.5">
                  {folder.children.map((child) => (
                    <li key={child.id}>
                      <div
                        className={`group flex items-center gap-1 rounded-md py-1.5 pr-2 pl-6 text-sm transition ${
                          selectedFolderId === child.id
                            ? 'app-active font-medium app-active-text dark:app-active dark:text-blue-300'
                            : 'app-text hover:app-muted dark:app-text dark:hover:app-muted'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectFolder(child.id)}
                          className="min-w-0 flex-1 truncate text-left"
                          title={child.name}
                        >
                          {child.name}
                        </button>
                        <UnreadBadge count={child.unread} />
                        <span className="hidden shrink-0 gap-0.5 group-hover:flex focus-within:flex">
                          <button
                            type="button"
                            onClick={() => void promptRename(child)}
                            title={`Rename ${child.name}`}
                            className="rounded px-1 text-xs app-text-muted hover:app-muted hover:app-text dark:hover:app-muted dark:hover:app-text"
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDeleteFolder(child)}
                            title={`Delete ${child.name}`}
                            className="rounded px-1 text-xs app-text-muted hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-950 dark:hover:text-red-300"
                          >
                            ✕
                          </button>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {unfiledCount > 0 && (
        <button
          type="button"
          onClick={() => onSelectFolder(null)}
          className={`flex w-full items-center rounded-md px-2 py-1.5 text-sm transition ${
            selectedFolderId === null
              ? 'app-active font-medium app-active-text dark:app-active dark:text-blue-300'
              : 'app-text-muted hover:app-muted dark:app-text-muted dark:hover:app-muted'
          }`}
        >
          <span className="truncate">Unfiled</span>
          <span className="ml-auto text-xs app-text-muted">{unfiledCount}</span>
        </button>
      )}
    </div>
  );
}
