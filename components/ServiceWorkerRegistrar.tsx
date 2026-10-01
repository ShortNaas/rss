'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker that makes the app installable and gives it an
 * offline shell.
 *
 * Registration is skipped in development on purpose: the dev server rebuilds
 * chunks continuously, so a cache-first service worker would serve stale code
 * and make hot reload appear broken. `next build && next start` registers it.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    // Register after load so the worker never competes with first paint.
    function register() {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
        // A failed registration only costs offline support and installability;
        // the app itself keeps working, so this is not worth surfacing.
        console.warn('Service worker registration failed:', error);
      });
    }

    if (document.readyState === 'complete') {
      register();
      return;
    }

    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
