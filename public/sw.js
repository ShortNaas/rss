/*
 * Service worker: makes the app installable and usable offline.
 *
 * This is a navigation shell, not an offline reader. The feed list, articles,
 * and search all come from /api/*, which is deliberately never cached — cached
 * API responses would serve stale unread counts and, worse, outlive a logout.
 * What is cached is the app shell, so opening the app with no network shows the
 * interface with its normal "couldn't load" state instead of the browser's
 * offline error page.
 *
 * CACHE_VERSION must be bumped when the caching strategy changes; the activate
 * handler deletes every cache that does not match the current name.
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `rss-reader-${CACHE_VERSION}`;
const SHELL_URL = '/';

/** Pre-cached on install: the shell plus the two immutable assets. */
const PRECACHE = [SHELL_URL, '/manifest.webmanifest', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Individually, so one failure cannot abort the whole install.
      await Promise.all(
        PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' }))),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.map((name) => (name === CACHE_NAME ? undefined : caches.delete(name))),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only GET is cacheable.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Same-origin only; never intercept third-party requests.
  if (url.origin !== self.location.origin) return;

  // Never touch the API or auth routes: see the note at the top.
  if (url.pathname.startsWith('/api/')) return;

  // Content-hashed build output is immutable, so cache-first is safe and fast.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
        }
        return response;
      })(),
    );
    return;
  }

  // Navigations: network-first so the app is always current when online, with
  // the pre-cached shell as the offline fallback.
  //
  // The shell is read back with ignoreVary, and navigations are NOT written to
  // the cache. Next sends `Vary: rsc, next-router-state-tree, ...` on HTML, so a
  // plain caches.match() would miss the cached shell whenever those headers
  // differ — which they routinely do. The shell is cached once at install
  // instead, where the Vary header is irrelevant to reading it back.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cached = await caches.match(SHELL_URL, { ignoreVary: true });
          if (cached) return cached;
          return new Response('Offline', {
            status: 503,
            headers: { 'content-type': 'text/plain' },
          });
        }
      })(),
    );
  }
});
