'use client';

interface RefreshButtonProps {
  onRefresh: () => void;
  busy: boolean;
  /** Number of feeds being refreshed, for the progress label. */
  feedCount?: number;
}

export function RefreshButton({ onRefresh, busy, feedCount }: RefreshButtonProps) {
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span
        aria-hidden
        className={`inline-block ${busy ? 'animate-spin' : ''}`}
        style={{ transformOrigin: 'center' }}
      >
        ↻
      </span>
      {busy ? 'Refreshing…' : feedCount ? `Refresh ${feedCount} feeds` : 'Refresh'}
    </button>
  );
}
