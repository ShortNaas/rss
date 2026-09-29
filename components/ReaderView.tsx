'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { absoluteTime, apiFetch, relativeTime } from '@/lib/api';
import { loadReaderPrefs, saveReaderPrefs, type ReaderPrefs } from '@/lib/readerPrefs';
import type { ArticleSummary } from '@/lib/types';

export interface ReaderViewProps {
  articleId: number;
  /** Link to try when the article row has none (rare). */
  onClose: () => void;
  onReadStateChange: (articleId: number, isRead: boolean) => void;
  onOpenSource: (article: ArticleSummary) => void;
}

type FontSize = 'sm' | 'md' | 'lg';

/**
 * Sizes are applied as inline CSS custom properties rather than utility
 * classes: an earlier version used arbitrary-value classes (text-[1.2rem])
 * which lost to the `.article-body` rule at equal specificity, so every size
 * looked identical. Inline styles cannot be overridden that way.
 */
const FONT_VARS: Record<FontSize, React.CSSProperties> = {
  sm: { '--reader-size': 'var(--reader-size-sm)', '--reader-leading': 'var(--reader-leading-sm)' } as React.CSSProperties,
  md: { '--reader-size': 'var(--reader-size-md)', '--reader-leading': 'var(--reader-leading-md)' } as React.CSSProperties,
  lg: { '--reader-size': 'var(--reader-size-lg)', '--reader-leading': 'var(--reader-leading-lg)' } as React.CSSProperties,
};

const SIZE_ORDER: FontSize[] = ['sm', 'md', 'lg'];

const RETURN_FOCUS_KEY = 'reader-return-focus';

/** Below this many characters of text, an article is treated as a teaser. */
const THIN_CONTENT_CHARS = 400;

/**
 * Distraction-free reading view.
 *
 * Renders as a fixed full-viewport layer, so the list, sidebar, search box,
 * badges, and header are all genuinely gone rather than visually toned down.
 *
 * Feeds that publish only a teaser (BBC, Hacker News) are detected by length
 * and the full text is fetched from the source page automatically, so opening
 * an article presents the article rather than a one-line description.
 */
export function ReaderView({
  articleId,
  onClose,
  onReadStateChange,
  onOpenSource,
}: ReaderViewProps) {
  const [article, setArticle] = useState<ArticleSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [autoExtracted, setAutoExtracted] = useState(false);

  const [fontSize, setFontSize] = useState<FontSize>('md');
  const [progress, setProgress] = useState(0);
  const [prefs, setPrefs] = useState<ReaderPrefs | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // --- preferences ---------------------------------------------------------

  useEffect(() => {
    const stored = loadReaderPrefs();
    setPrefs(stored);
    if (stored.fontSize) setFontSize(stored.fontSize);
  }, []);

  const updatePrefs = useCallback((patch: Partial<ReaderPrefs>) => {
    setPrefs((previous) => {
      const base = previous ?? loadReaderPrefs();
      const next = { ...base, ...patch };
      saveReaderPrefs(next);
      if (next.fontSize) setFontSize(next.fontSize);
      return next;
    });
  }, []);

  // --- data ----------------------------------------------------------------

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ article: ArticleSummary }>(`/api/articles/${articleId}`);
      setArticle(data.article ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load this article');
    } finally {
      setLoading(false);
    }
  }, [articleId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Fetches the full text from the source page and swaps it in. */
  const extract = useCallback(
    async (options: { force?: boolean } = {}) => {
      if (!article?.link) return;
      setExtracting(true);
      setExtractError(null);

      try {
        const data = await apiFetch<{ article: ArticleSummary }>(
          `/api/articles/${article.id}/extract`,
          {
            method: 'POST',
            body: JSON.stringify(options),
            headers: buildProxyHeaders(loadReaderPrefs()),
          },
        );
        setArticle(data.article);
        setAutoExtracted(false);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'Could not fetch the full text';
        setExtractError(message);
        setAutoExtracted(false);
      } finally {
        setExtracting(false);
      }
    },
    [article],
  );

  // Auto-extract when the feed only carried a teaser. Runs at most once per
  // article open, so a manual retry or a failure cannot cause a loop.
  useEffect(() => {
    if (!article || !prefs) return;
    if (autoExtracted || extracting) return;
    if (!prefs.autoExtract) return;
    if (article.isExtracted) return;
    if (!article.link) return;

    const text = stripHtml(article.content ?? '');
    const summaryText = article.summary ?? '';
    const length = Math.max(text.length, summaryText.length);

    // Only auto-fetch when the feed clearly did not include the body.
    if (length > 0 && length < THIN_CONTENT_CHARS) {
      setAutoExtracted(true);
      void extract();
    }
  }, [article, autoExtracted, extract, extracting, prefs]);

  // Reset scroll position when switching articles.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [articleId]);

  // --- body scroll lock and focus management -------------------------------

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    return () => {
      try {
        const id = sessionStorage.getItem(RETURN_FOCUS_KEY);
        if (id) document.getElementById(id)?.focus();
      } catch {
        // Non-fatal.
      }
    };
  }, []);

  // --- reading progress ----------------------------------------------------

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    function onScroll() {
      if (!element) return;
      const scrollable = element.scrollHeight - element.clientHeight;
      setProgress(scrollable > 0 ? Math.min(1, element.scrollTop / scrollable) : 0);
    }

    element.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => element.removeEventListener('scroll', onScroll);
  }, [article]);

  // --- actions -------------------------------------------------------------

  const toggleRead = useCallback(async () => {
    if (!article) return;
    const next = !article.isRead;
    setArticle({ ...article, isRead: next });
    onReadStateChange(article.id, next);
    try {
      await apiFetch(`/api/articles/${article.id}/read`, {
        method: 'POST',
        body: JSON.stringify({ isRead: next }),
      });
    } catch {
      // The list reconciles on reload; a failed toggle is not worth an alert.
    }
  }, [article, onReadStateChange]);

  const openSource = useCallback(
    (target?: string) => {
      if (!article) return;
      const url = target ?? article.link;
      if (!url) return;
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    [article],
  );

  // --- keyboard shortcuts --------------------------------------------------

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          if (showPrefs) setShowPrefs(false);
          else onClose();
          break;
        case 'm':
          event.preventDefault();
          void toggleRead();
          break;
        case 'o':
          event.preventDefault();
          openSource();
          break;
        case 'f':
          // Fetch the full text on demand.
          if (article?.link && !extracting) {
            event.preventDefault();
            void extract({ force: Boolean(article.isExtracted) });
          }
          break;
        case 's':
          event.preventDefault();
          updatePrefs({
            fontSize: SIZE_ORDER[(SIZE_ORDER.indexOf(fontSize) + 1) % SIZE_ORDER.length],
          });
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [article, extracting, extract, fontSize, onClose, openSource, showPrefs, toggleRead, updatePrefs]);

  const sourceHost = hostOf(article?.link ?? null);
  const hasBody = Boolean(article?.content && stripHtml(article.content).length > 0);
  const isTeaser = Boolean(article && !article.isExtracted && stripHtml(article.content ?? '').length < THIN_CONTENT_CHARS);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col app-panel dark:app-bg"
      role="dialog"
      aria-modal="true"
      aria-label="Article reader"
    >
      <div className="h-0.5 w-full app-muted dark:app-muted">
        <div
          className="h-full bg-blue-600 transition-[width] duration-150"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <header className="flex shrink-0 items-center gap-3 border-b app-border px-4 py-2.5 dark:app-border">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm app-text-muted transition hover:app-muted dark:app-text dark:hover:app-muted"
          title="Close reader (Esc)"
        >
          <span aria-hidden>←</span> Back
        </button>

        <span className="min-w-0 flex-1 truncate text-xs app-text-muted dark:app-text-muted">
          {article?.feedTitle ?? ''}
          {article?.isExtracted && (
            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              full text
            </span>
          )}
        </span>

        <div className="flex items-center gap-1">
          <div
            className="hidden items-center overflow-hidden rounded-md border app-border sm:flex dark:app-border"
            role="group"
            aria-label="Text size"
          >
            {(['sm', 'md', 'lg'] as const).map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => updatePrefs({ fontSize: size })}
                aria-pressed={fontSize === size}
                title={`Text size: ${size === 'sm' ? 'small' : size === 'md' ? 'medium' : 'large'}`}
                className={`px-2.5 py-1 transition ${
                  fontSize === size
                    ? 'app-active font-semibold'
                    : 'app-text-muted hover:app-muted'
                }`}
              >
                <span className={size === 'sm' ? 'text-xs' : size === 'md' ? 'text-sm' : 'text-base'}>
                  A
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void toggleRead()}
            className="rounded-md px-2 py-1.5 text-sm app-text-muted transition hover:app-muted dark:app-text dark:hover:app-muted"
            title="Toggle read (m)"
          >
            {article?.isRead ? '✓ Read' : 'Mark read'}
          </button>

          <button
            type="button"
            onClick={() => setShowPrefs((previous) => !previous)}
            aria-expanded={showPrefs}
            className="rounded-md px-2 py-1.5 text-sm app-text-muted transition hover:app-muted dark:app-text dark:hover:app-muted"
            title="Reading settings"
          >
            ⚙
          </button>
        </div>
      </header>

      {showPrefs && (
        <div className="shrink-0 border-b app-border app-bg px-4 py-3 dark:app-border dark:app-muted">
          <div className="mx-auto flex max-w-[46rem] flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <label className="flex items-center gap-2 app-text dark:app-text">
              <input
                type="checkbox"
                checked={prefs?.autoExtract ?? true}
                onChange={(event) => updatePrefs({ autoExtract: event.target.checked })}
                className="accent-blue-600"
              />
              Automatically fetch full text
            </label>
            <span className="text-xs app-text-muted dark:app-text-muted">
              For feeds that only publish a summary.
            </span>
            <p className="w-full text-xs app-text-muted dark:app-text-muted">
              Blocked by a paywall or bot check? Point <code>PROXY_BASE_URL</code> at a fetch proxy
              on the server; the reader authenticates with the stored secret when one is set.
            </p>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <p className="p-10 text-center text-sm app-text-muted dark:app-text-muted">
            Loading article…
          </p>
        )}

        {!loading && error && (
          <div className="mx-auto max-w-2xl p-10 text-center">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-4 rounded-md border app-border px-3 py-1.5 text-sm dark:app-border"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && !article && (
          <p className="p-10 text-center text-sm app-text-muted dark:app-text-muted">
            That article no longer exists.
          </p>
        )}

        {!loading && !error && article && (
          <article className="mx-auto max-w-[46rem] px-5 py-10 sm:px-8">
            <h1 className="font-serif text-3xl leading-tight font-semibold tracking-tight app-text sm:text-4xl dark:app-text">
              {article.title ?? '(untitled)'}
            </h1>

            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm app-text-muted dark:app-text-muted">
              <span className="font-medium app-text dark:app-text">
                {article.feedTitle}
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
                  <span>{article.author}</span>
                </>
              )}
            </div>

            {/* Extraction states: running, failed, or offered. */}
            {extracting && (
              <p className="mt-8 flex items-center gap-2 text-sm app-text-muted dark:app-text-muted">
                <span className="inline-block animate-spin" aria-hidden>
                  ↻
                </span>
                Fetching the full article from {sourceHost ?? 'the source'}…
              </p>
            )}

            {!extracting && extractError && (
              <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
                <p className="font-medium">Could not fetch the full text.</p>
                <p className="mt-1 text-xs">{extractError}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void extract({ force: true })}
                    className="rounded-md border border-amber-300 px-2.5 py-1 text-xs font-medium transition hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900/50"
                  >
                    Try again
                  </button>
                  {article.link && (
                    <button
                      type="button"
                      onClick={() => openSource()}
                      className="rounded-md border border-amber-300 px-2.5 py-1 text-xs font-medium transition hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900/50"
                    >
                      Read from source ↗
                    </button>
                  )}
                </div>
              </div>
            )}

            {!extracting && !extractError && isTeaser && article.link && (
              <div className="mt-6 rounded-lg border app-border app-bg px-4 py-3 dark:app-border dark:app-muted">
                <p className="text-sm app-text-muted dark:app-text">
                  This feed only publishes a short summary.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void extract()}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700"
                  >
                    Load full text
                  </button>
                  <button
                    type="button"
                    onClick={() => openSource()}
                    className="rounded-md border app-border px-3 py-1.5 text-xs app-text transition hover:app-muted dark:app-border dark:app-text dark:hover:app-muted"
                  >
                    Read from source ↗
                  </button>
                </div>
              </div>
            )}

            {!extracting && article.isExtracted && (
              <p className="mt-6 text-xs app-text-muted dark:app-text-muted">
                Full text extracted from{' '}
                {article.link ? (
                  <button
                    type="button"
                    onClick={() => openSource()}
                    className="underline hover:app-text-muted dark:hover:app-text-muted"
                  >
                    {sourceHost ?? 'the source'}
                  </button>
                ) : (
                  'the source'
                )}
                .{' '}
                <button
                  type="button"
                  onClick={() => void extract({ force: true })}
                  className="underline hover:app-text-muted dark:hover:app-text-muted"
                >
                  Refresh
                </button>
              </p>
            )}

            {hasBody ? (
              <div
                className="article-body mt-8 font-serif"
                style={FONT_VARS[fontSize]}
                // Sanitized server-side (lib/parser.ts, lib/extract.ts).
                dangerouslySetInnerHTML={{ __html: article.content ?? '' }}
              />
            ) : (
              !extracting && (
                <p className="mt-8 font-serif" style={FONT_VARS[fontSize]}>
                  {article.summary ?? 'This feed did not include the article body.'}
                </p>
              )
            )}

            <footer className="mt-12 border-t app-border pt-6 dark:app-border">
              <div className="flex flex-wrap gap-3">
                {article.link && (
                  <button
                    type="button"
                    onClick={() => openSource()}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
                  >
                    Read from source{sourceHost ? ` (${sourceHost})` : ''} ↗
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void toggleRead()}
                  className="rounded-md border app-border px-4 py-2 text-sm app-text transition hover:app-muted dark:app-border dark:app-text dark:hover:app-muted"
                >
                  Mark {article.isRead ? 'unread' : 'read'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border app-border px-4 py-2 text-sm app-text transition hover:app-muted dark:app-border dark:app-text dark:hover:app-muted"
                >
                  Back to list
                </button>
              </div>

              <p className="mt-6 text-xs app-text-muted dark:app-text-muted">
                Esc close · m mark read · o open source · f full text · s text size
              </p>
            </footer>
          </article>
        )}
      </div>
    </div>
  );
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Sends the stored proxy secret when one is configured in reader settings. */
function buildProxyHeaders(prefs: ReaderPrefs): Record<string, string> {
  return prefs.proxySecret ? { 'x-proxy-secret': prefs.proxySecret } : {};
}
