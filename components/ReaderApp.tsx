'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AddFeedForm } from './AddFeedForm';
import { ArticleList } from './ArticleList';
import { FeedList } from './FeedList';
import { FeedSettings } from './FeedSettings';
import { FolderTree } from './FolderTree';
import { ReaderView } from './ReaderView';
import { RefreshButton } from './RefreshButton';
import { TagFilter } from './TagFilter';
import { TagManager } from './TagManager';
import { ThemeToggle } from './ThemeToggle';
import { apiFetch } from '@/lib/api';
import type {
  ArticleSummary,
  ArticlesResponse,
  FeedSummary,
  FeedsResponse,
  FolderNode,
  OpmlImportSummary,
  RefreshReport,
  TagSummary,
} from '@/lib/types';

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

export interface ReaderAppProps {
  /** True when the app is running on PGlite with no DATABASE_URL set. */
  localDatabase: boolean;
}

export function ReaderApp({ localDatabase }: ReaderAppProps) {
  const [feeds, setFeeds] = useState<FeedSummary[]>([]);
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [totalUnread, setTotalUnread] = useState(0);

  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [query, setQuery] = useState<string | null>(null);

  // Exactly one of these is active at a time; selecting one clears the others.
  const [selectedFeedId, setSelectedFeedId] = useState<number | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);

  const [unreadOnly, setUnreadOnly] = useState(false);
  const [searchInput, setSearchInput] = useState('');

  /** Article open in the distraction-free reader, if any. */
  const [readerArticleId, setReaderArticleId] = useState<number | null>(null);

  const [settingsFeed, setSettingsFeed] = useState<FeedSummary | null>(null);
  const [showTagManager, setShowTagManager] = useState(false);

  const [loadingArticles, setLoadingArticles] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [opmlBusy, setOpmlBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);

  // --- data loading -------------------------------------------------------

  const loadFeeds = useCallback(async () => {
    const data = await apiFetch<FeedsResponse>('/api/feeds');
    setFeeds(data.feeds);
    setFolders(data.folders);
    setTags(data.tags);
    setTotalUnread(data.totalUnread);
  }, []);

  const filters = useMemo(
    () => ({
      search: searchInput.trim(),
      feedId: selectedFeedId,
      folderId: selectedFolderId,
      tagId: selectedTagId,
      unread: unreadOnly,
    }),
    [searchInput, selectedFeedId, selectedFolderId, selectedTagId, unreadOnly],
  );

  const loadArticles = useCallback(
    async (options: { offset: number; append: boolean }) => {
      const requestId = ++requestIdRef.current;
      if (options.append) setLoadingMore(true);
      else setLoadingArticles(true);

      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(options.offset),
      });
      if (filters.feedId !== null) params.set('feedId', String(filters.feedId));
      if (filters.folderId !== null) params.set('folderId', String(filters.folderId));
      if (filters.tagId !== null) params.set('tagId', String(filters.tagId));
      if (filters.unread) params.set('unread', 'true');
      if (filters.search) params.set('q', filters.search);

      try {
        const data = await apiFetch<ArticlesResponse>(`/api/articles?${params.toString()}`);
        if (requestId !== requestIdRef.current) return;

        setArticles((previous) =>
          options.append ? [...previous, ...data.articles] : data.articles,
        );
        setTotal(data.total);
        setHasMore(data.hasMore);
        setQuery(data.query);
        setError(null);
      } catch (caught) {
        if (requestId !== requestIdRef.current) return;
        setError(caught instanceof Error ? caught.message : 'Could not load articles');
      } finally {
        if (requestId === requestIdRef.current) {
          setLoadingArticles(false);
          setLoadingMore(false);
        }
      }
    },
    [filters],
  );

  useEffect(() => {
    const timer = setTimeout(
      () => void loadArticles({ offset: 0, append: false }),
      filters.search ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [filters, loadArticles]);

  useEffect(() => {
    void loadFeeds().catch((caught) => {
      setError(caught instanceof Error ? caught.message : 'Could not load feeds');
    });
  }, [loadFeeds]);

  const reload = useCallback(async () => {
    await Promise.all([loadFeeds(), loadArticles({ offset: 0, append: false })]);
  }, [loadArticles, loadFeeds]);

  // --- selection ----------------------------------------------------------

  const selectFeed = useCallback((feedId: number | null) => {
    setSelectedFeedId(feedId);
    setSelectedFolderId(null);
    setSelectedTagId(null);
  }, []);

  const selectFolder = useCallback((folderId: number | null) => {
    setSelectedFolderId(folderId);
    setSelectedFeedId(null);
    setSelectedTagId(null);
  }, []);

  const selectTag = useCallback((tagId: number | null) => {
    setSelectedTagId(tagId);
    setSelectedFeedId(null);
    setSelectedFolderId(null);
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedFeedId(null);
    setSelectedFolderId(null);
    setSelectedTagId(null);
  }, []);

  // --- actions ------------------------------------------------------------

  async function handleRefresh(feedId?: number) {
    if (refreshing) return;
    setRefreshing(true);
    setStatus(null);
    setError(null);

    try {
      const report = await apiFetch<RefreshReport>('/api/refresh', {
        method: 'POST',
        body: JSON.stringify(feedId === undefined ? {} : { feedId }),
      });

      const parts: string[] = [];
      if (report.inserted > 0) parts.push(`${report.inserted} new`);
      if (report.updated > 0) parts.push(`${report.updated} updated`);
      if (report.unchanged > 0) parts.push(`${report.unchanged} unchanged`);
      if (report.failed > 0) parts.push(`${report.failed} failed`);
      if (report.skipped > 0) parts.push(`${report.skipped} skipped`);
      parts.push(`${(report.durationMs / 1000).toFixed(1)}s`);

      const failures = report.results.filter((result) => result.status === 'error');
      setStatus(
        `Refreshed ${report.total} feed${report.total === 1 ? '' : 's'}: ${parts.join(', ')}.` +
          (failures.length > 0
            ? ` Failing: ${failures.map((f) => f.title ?? f.url).join(', ')}`
            : ''),
      );

      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleAddFeed(url: string): Promise<{ added: number } | void> {
    const result = await apiFetch<{ added: number }>('/api/feeds', {
      method: 'POST',
      body: JSON.stringify({
        url,
        // Adding while viewing a folder files the feed there.
        ...(selectedFolderId !== null ? { folderId: selectedFolderId } : {}),
      }),
    });
    await reload();
    return { added: result.added };
  }

  async function handleDeleteFeed(feed: FeedSummary) {
    const label = feed.title ?? feed.url;
    if (!window.confirm(`Remove “${label}” and all of its articles?`)) return;

    try {
      await apiFetch(`/api/feeds/${feed.id}`, { method: 'DELETE' });
      if (selectedFeedId === feed.id) setSelectedFeedId(null);
      await reload();
      setStatus(`Removed “${label}”.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove that feed');
    }
  }

  async function handleSaveFeedSettings(changes: {
    title: string | null;
    folderId: number | null;
    tags: string[];
  }) {
    if (!settingsFeed) return;

    // Title and folder go through the feed PATCH; tags have their own endpoint.
    await apiFetch(`/api/feeds/${settingsFeed.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: changes.title, folderId: changes.folderId }),
    });

    await apiFetch(`/api/feeds/${settingsFeed.id}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tags: changes.tags }),
    });

    await reload();
    setStatus(`Saved settings for “${changes.title ?? settingsFeed.url}”.`);
  }

  async function handleCreateFolder(name: string, parentId: number | null) {
    try {
      await apiFetch('/api/folders', { method: 'POST', body: JSON.stringify({ name, parentId }) });
      await loadFeeds();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create that folder');
      throw caught;
    }
  }

  async function handleRenameFolder(folderId: number, name: string) {
    try {
      await apiFetch('/api/folders', {
        method: 'PATCH',
        body: JSON.stringify({ id: folderId, name }),
      });
      await loadFeeds();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not rename that folder');
    }
  }

  async function handleDeleteFolder(folder: FolderNode) {
    if (
      !window.confirm(
        `Delete folder “${folder.name}”?\n\nIts feeds are moved up a level rather than deleted, and its articles are kept.`,
      )
    ) {
      return;
    }

    try {
      await apiFetch(`/api/folders?id=${folder.id}`, { method: 'DELETE' });
      if (selectedFolderId === folder.id) setSelectedFolderId(null);
      await reload();
      setStatus(`Deleted folder “${folder.name}”.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete that folder');
    }
  }

  async function handleRenameTag(tagId: number, name: string) {
    try {
      const result = await apiFetch<{ merged: boolean }>('/api/tags', {
        method: 'PATCH',
        body: JSON.stringify({ id: tagId, name }),
      });
      // A merge invalidates the old tag id.
      if (result.merged && selectedTagId === tagId) setSelectedTagId(null);
      await reload();
      setStatus(result.merged ? `Merged into “${name}”.` : `Renamed tag to “${name}”.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not rename that tag');
    }
  }

  async function handleDeleteTag(tag: TagSummary) {
    if (!window.confirm(`Delete the tag “${tag.name}”? Feeds and articles are not affected.`)) {
      return;
    }

    try {
      await apiFetch(`/api/tags?id=${tag.id}`, { method: 'DELETE' });
      if (selectedTagId === tag.id) setSelectedTagId(null);
      await reload();
      setStatus(`Deleted tag “${tag.name}”.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete that tag');
    }
  }

  async function handleToggleRead(article: ArticleSummary, isRead: boolean) {
    // Optimistic: the checkbox should respond instantly.
    setArticles((previous) =>
      previous.map((item) => (item.id === article.id ? { ...item, isRead } : item)),
    );
    setTotalUnread((previous) => Math.max(0, previous + (isRead ? -1 : 1)));
    setFeeds((previous) =>
      previous.map((feed) =>
        feed.id === article.feedId
          ? { ...feed, unread: Math.max(0, feed.unread + (isRead ? -1 : 1)) }
          : feed,
      ),
    );

    try {
      await apiFetch(`/api/articles/${article.id}/read`, {
        method: 'POST',
        body: JSON.stringify({ isRead }),
      });
      // Reconcile against the server, since counts may have drifted.
      void loadFeeds();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update read state');
      await reload();
    }
  }

  /** Applies a read-state change made inside the reader, without a refetch. */
  const handleReaderReadChange = useCallback(
    (articleId: number, isRead: boolean) => {
      setArticles((previous) =>
        previous.map((item) => (item.id === articleId ? { ...item, isRead } : item)),
      );
      void loadFeeds();
    },
    [loadFeeds],
  );

  async function handleMarkAllRead() {
    const scope = selectedFeedId !== null
      ? feeds.find((feed) => feed.id === selectedFeedId)?.title ?? 'this feed'
      : 'every feed';
    if (!window.confirm(`Mark all articles in ${scope} as read?`)) return;

    try {
      const result = await apiFetch<{ updated: number }>('/api/articles/read-all', {
        method: 'POST',
        body: JSON.stringify({
          isRead: true,
          ...(selectedFeedId !== null ? { feedId: selectedFeedId } : {}),
          ...(filters.search ? { q: filters.search } : {}),
        }),
      });
      setStatus(`Marked ${result.updated} article${result.updated === 1 ? '' : 's'} as read.`);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not mark articles as read');
    }
  }

  function handleOpenOriginal(article: ArticleSummary) {
    if (!article.link) return;
    window.open(article.link, '_blank', 'noopener,noreferrer');
    if (!article.isRead) void handleToggleRead(article, true);
  }

  const handleOpenReader = useCallback((article: ArticleSummary) => {
    // Remember what to focus when the reader closes.
    try {
      sessionStorage.setItem('reader-return-focus', `article-title-${article.id}`);
    } catch {
      // Non-fatal.
    }
    setReaderArticleId(article.id);
    if (!article.isRead) void handleToggleRead(article, true);
  }, []);

  function handleLoadMore() {
    void loadArticles({ offset: articles.length, append: true });
  }

  async function handleImportFile(file: File) {
    setOpmlBusy(true);
    setError(null);
    setStatus(null);

    try {
      const body = new FormData();
      body.append('file', file);
      const summary = await apiFetch<OpmlImportSummary>('/api/opml/import', {
        method: 'POST',
        body,
        headers: {},
      });

      setStatus(
        `Imported ${summary.imported} feed${summary.imported === 1 ? '' : 's'}` +
          ` (${summary.duplicates} already present, ${summary.invalid} invalid)` +
          (summary.fetched ? `, fetched ${summary.fetched.inserted} articles.` : '.'),
      );
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'OPML import failed');
    } finally {
      setOpmlBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // --- derived ------------------------------------------------------------

  const selectedFeed = feeds.find((feed) => feed.id === selectedFeedId) ?? null;
  const selectedTag = tags.find((tag) => tag.id === selectedTagId) ?? null;

  /** Feeds visible for the current folder selection. */
  const visibleFeeds = useMemo(() => {
    if (selectedFolderId === null) return feeds.filter((feed) => feed.folderId === null);
    const childIds = folders
      .flatMap((folder) => folder.children)
      .filter((child) => child.parentId === selectedFolderId)
      .map((child) => child.id);
    return feeds.filter(
      (feed) => feed.folderId === selectedFolderId || childIds.includes(feed.folderId ?? -1),
    );
  }, [feeds, folders, selectedFolderId]);

  const allTagNames = useMemo(
    () => Array.from(new Set(tags.map((tag) => tag.name))).sort(),
    [tags],
  );

  const title = selectedFeed
    ? selectedFeed.title ?? selectedFeed.url
    : selectedTag
      ? `Tag: ${selectedTag.name}`
      : selectedFolderId !== null
        ? (findFolderName(folders, selectedFolderId) ?? 'Folder')
        : 'All articles';

  return (
    <div className="flex min-h-screen flex-col">
      <header className="safe-top sticky top-0 z-10 border-b app-border app-panel/90 backdrop-blur dark:app-border dark:app-bg/90">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <h1 className="text-lg font-semibold tracking-tight">RSS Reader</h1>

          <div className="relative order-last w-full sm:order-none sm:ml-4 sm:w-72">
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search articles…"
              aria-label="Search articles"
              className="w-full rounded-md border app-border app-panel px-3 py-1.5 text-sm outline-none placeholder:app-text-muted focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:app-border dark:app-muted dark:app-text"
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="hidden rounded-md border app-border px-3 py-1.5 text-sm app-text transition hover:app-muted sm:inline-block dark:app-border dark:app-text dark:hover:app-muted"
            >
              Mark all read
            </button>
            <RefreshButton
              onRefresh={() => void handleRefresh()}
              busy={refreshing}
              feedCount={selectedFeedId === null ? feeds.length : 1}
            />
            <ThemeToggle />
          </div>
        </div>

        {(localDatabase || status || error) && (
          <div className="mx-auto max-w-7xl space-y-1 px-4 pb-3">
            {localDatabase && (
              <p className="rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                Running on local PGlite (no <code>DATABASE_URL</code> set). Data is stored in{' '}
                <code>.pglite-data/</code> and will not be available in production.
              </p>
            )}
            {status && (
              <p className="rounded-md app-muted px-3 py-1.5 text-xs app-text dark:app-muted dark:app-text">
                {status}
              </p>
            )}
            {error && (
              <p
                role="alert"
                className="rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:bg-red-950/60 dark:text-red-300"
              >
                {error}
              </p>
            )}
          </div>
        )}
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-4 py-5">
        <aside className="hidden w-72 shrink-0 flex-col gap-4 overflow-y-auto sm:flex">
          <section className="rounded-lg border app-border app-panel p-3 dark:app-border dark:app-muted/60">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide app-text-muted dark:app-text-muted">
              Add a feed
            </h2>
            <AddFeedForm onAdd={handleAddFeed} disabled={opmlBusy} />
            {selectedFolderId !== null && (
              <p className="mt-2 text-xs text-blue-700 dark:text-blue-400">
                New feeds are filed in “{findFolderName(folders, selectedFolderId)}”.
              </p>
            )}
          </section>

          <section className="rounded-lg border app-border app-panel p-3 dark:app-border dark:app-muted/60">
            <button
              type="button"
              onClick={clearFilters}
              className={`flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition ${
                selectedFeedId === null && selectedFolderId === null && selectedTagId === null
                  ? 'app-active font-medium app-active-text dark:app-active dark:text-blue-300'
                  : 'app-text hover:app-muted dark:app-text dark:hover:app-muted'
              }`}
            >
              All articles
              {totalUnread > 0 && (
                <span className="ml-auto rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">
                  {totalUnread > 999 ? '999+' : totalUnread}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setUnreadOnly((previous) => !previous)}
              aria-pressed={unreadOnly}
              className={`mt-0.5 flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition ${
                unreadOnly
                  ? 'app-active font-medium app-active-text dark:app-active dark:text-blue-300'
                  : 'app-text hover:app-muted dark:app-text dark:hover:app-muted'
              }`}
            >
              {unreadOnly ? '☑' : '☐'} Unread only
            </button>

            <div className="my-3 border-t app-border dark:app-border" />

            <FolderTree
              folders={folders}
              feeds={feeds}
              selectedFolderId={selectedFolderId}
              onSelectFolder={selectFolder}
              onCreateFolder={handleCreateFolder}
              onRenameFolder={handleRenameFolder}
              onDeleteFolder={handleDeleteFolder}
            />

            <div className="my-3 border-t app-border dark:app-border" />

            <TagFilter
              tags={tags}
              selectedTagId={selectedTagId}
              onSelectTag={selectTag}
              onManage={() => setShowTagManager(true)}
            />
          </section>

          <section className="rounded-lg border app-border app-panel p-3 dark:app-border dark:app-muted/60">
            <FeedList
              feeds={visibleFeeds}
              sectionLabel={
                selectedFolderId === null
                  ? 'Feeds (no folder)'
                  : findFolderName(folders, selectedFolderId) ?? 'Feeds'
              }
              selectedFeedId={selectedFeedId}
              onSelectFeed={selectFeed}
              onOpenSettings={setSettingsFeed}
              onDeleteFeed={handleDeleteFeed}
              onRefreshFeed={(feed) => void handleRefresh(feed.id)}
              onImportClick={() => fileInputRef.current?.click()}
              onExportClick={() => window.open('/api/opml/export', '_blank')}
              opmlBusy={opmlBusy}
            />
          </section>
        </aside>

        <main className="min-w-0 flex-1">
          {/* Compact controls for narrow screens, where the sidebar is hidden. */}
          <div className="mb-3 flex flex-wrap items-center gap-2 sm:hidden">
            <label className="text-xs app-text-muted dark:app-text-muted">
              Folder
              <select
                value={selectedFolderId ?? ''}
                onChange={(event) =>
                  selectFolder(event.target.value === '' ? null : Number(event.target.value))
                }
                className="ml-2 rounded-md border app-border app-panel px-2 py-1 text-sm dark:app-border dark:app-muted"
              >
                <option value="">All feeds</option>
                {folders.map((folder) => (
                  <optgroup key={folder.id} label={folder.name}>
                    <option value={folder.id}>{folder.name} (folder)</option>
                    {folder.children.map((child) => (
                      <option key={child.id} value={child.id}>
                        {child.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            <label className="text-xs app-text-muted dark:app-text-muted">
              Feed
              <select
                value={selectedFeedId ?? ''}
                onChange={(event) =>
                  selectFeed(event.target.value === '' ? null : Number(event.target.value))
                }
                className="ml-2 rounded-md border app-border app-panel px-2 py-1 text-sm dark:app-border dark:app-muted"
              >
                <option value="">All</option>
                {feeds.map((feed) => (
                  <option key={feed.id} value={feed.id}>
                    {feed.title ?? feed.url}
                  </option>
                ))}
              </select>
            </label>

            {tags.length > 0 && (
              <label className="text-xs app-text-muted dark:app-text-muted">
                Tag
                <select
                  value={selectedTagId ?? ''}
                  onChange={(event) =>
                    selectTag(event.target.value === '' ? null : Number(event.target.value))
                  }
                  className="ml-2 rounded-md border app-border app-panel px-2 py-1 text-sm dark:app-border dark:app-muted"
                >
                  <option value="">All</option>
                  {tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="flex items-center gap-1 text-xs app-text-muted dark:app-text-muted">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={() => setUnreadOnly((previous) => !previous)}
                className="accent-blue-600"
              />
              Unread only
            </label>
          </div>

          <div className="overflow-hidden rounded-lg border app-border app-panel dark:app-border dark:app-muted/60">
            <div className="flex items-center justify-between border-b app-border px-4 py-2.5 dark:app-border">
              <h2 className="truncate text-sm font-semibold">{title}</h2>
              <div className="flex shrink-0 items-center gap-3">
                {(selectedFeed || selectedTag || selectedFolderId !== null) && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-xs app-text-muted hover:app-text dark:hover:app-text"
                  >
                    Clear filter
                  </button>
                )}
                {selectedFeed?.siteUrl && (
                  <a
                    href={selectedFeed.siteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-700 hover:underline dark:text-blue-400"
                  >
                    Visit site ↗
                  </a>
                )}
              </div>
            </div>

            {selectedFeed?.lastError && (
              <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300">
                Last refresh failed: {selectedFeed.lastError}
              </p>
            )}

            <ArticleList
              articles={articles}
              loading={loadingArticles}
              loadingMore={loadingMore}
              hasMore={hasMore}
              total={total}
              query={query}
              onOpen={handleOpenReader}
              onToggleRead={handleToggleRead}
              onOpenOriginal={handleOpenOriginal}
              onLoadMore={handleLoadMore}
            />
          </div>
        </main>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".opml,.xml,text/xml,text/x-opml"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleImportFile(file);
        }}
      />

      {readerArticleId !== null && (
        <ReaderView
          articleId={readerArticleId}
          onClose={() => setReaderArticleId(null)}
          onReadStateChange={handleReaderReadChange}
          onOpenSource={handleOpenOriginal}
        />
      )}

      {settingsFeed && (
        <FeedSettings
          feed={settingsFeed}
          folders={folders}
          knownTags={allTagNames}
          onClose={() => setSettingsFeed(null)}
          onSave={handleSaveFeedSettings}
        />
      )}

      {showTagManager && (
        <TagManager
          tags={tags}
          onClose={() => setShowTagManager(false)}
          onRename={handleRenameTag}
          onDelete={handleDeleteTag}
        />
      )}
    </div>
  );
}

/** Finds a folder's display name anywhere in the two-level tree. */
function findFolderName(folders: FolderNode[], id: number): string | null {
  for (const folder of folders) {
    if (folder.id === id) return folder.name;
    for (const child of folder.children) {
      if (child.id === id) return child.name;
    }
  }
  return null;
}
