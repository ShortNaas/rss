'use client';

import { useState } from 'react';

interface AddFeedFormProps {
  onAdd: (url: string) => Promise<{ added: number } | void>;
  disabled?: boolean;
}

/**
 * Adds a feed by URL. The API also accepts a plain site URL and will
 * autodiscover its feed, which the hint text advertises.
 */
export function AddFeedForm({ onAdd, disabled }: AddFeedFormProps) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await onAdd(trimmed);
      setUrl('');
      const added = result && typeof result === 'object' ? result.added : undefined;
      if (typeof added === 'number') {
        setNotice(
          added > 0
            ? `Added — fetched ${added} new article${added === 1 ? '' : 's'}.`
            : 'Added — no new articles found.',
        );
      } else {
        setNotice('Feed added.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add that feed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com/feed.xml"
          disabled={disabled || busy}
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-md border app-border app-panel px-3 py-1.5 text-sm outline-none placeholder:app-text-muted focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-60 dark:app-border dark:app-muted dark:app-text"
        />
        <button
          type="submit"
          disabled={disabled || busy || url.trim().length === 0}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>

      <p className="text-xs app-text-muted dark:app-text-muted">
        A feed URL, or any site URL — a feed link is looked up automatically.
      </p>

      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">{notice}</p>
      )}
    </form>
  );
}
