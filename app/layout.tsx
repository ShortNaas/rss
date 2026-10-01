import type { Metadata, Viewport } from 'next';
import { ServiceWorkerRegistrar } from '@/components/ServiceWorkerRegistrar';
import './globals.css';

export const metadata: Metadata = {
  title: 'RSS Reader',
  description: 'A single-user RSS reader with in-app full-text reading.',
  robots: { index: false, follow: false },
  // Points at app/manifest.ts, which Next serves at /manifest.webmanifest.
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'RSS',
    // Lets the app's own background run under the status bar once installed.
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Paint under the notch/home indicator; globals.css pads the shell back in.
  viewportFit: 'cover',
  // Tints the browser UI to match the default (sepia) and dark themes.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2e9d8' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0c0d' },
  ],
};

/**
 * Applies the stored theme before first paint so a themed user never sees a
 * flash of the wrong palette.
 *
 * Sepia reading mode is the default: it is the easiest on the eyes for long
 * reading, so a first launch (or cleared storage) gets sepia.
 *
 * `light` is migrated to sepia once (MIGRATION_KEY). Earlier versions defaulted
 * to the OS preference without storing it, so a stored `light` is usually that
 * old implicit default rather than a deliberate choice. A deliberate choice is
 * preserved from then on; anyone who truly wants light clicks the toggle once.
 * An explicit `dark` is always respected.
 */
const THEME_BOOTSTRAP = `
(function () {
  var DEFAULT_THEME = 'sepia';
  var MIGRATION_KEY = 'rss-theme-migrated-sepia';
  var valid = { light: 1, sepia: 1, dark: 1 };

  try {
    var stored = localStorage.getItem('rss-theme');
    var migrated = localStorage.getItem(MIGRATION_KEY) === '1';

    if (stored === 'light' && !migrated) {
      stored = DEFAULT_THEME;
      localStorage.setItem('rss-theme', DEFAULT_THEME);
    }
    if (!migrated) localStorage.setItem(MIGRATION_KEY, '1');

    document.documentElement.setAttribute('data-theme', valid[stored] ? stored : DEFAULT_THEME);
  } catch (e) {
    // Storage unavailable (private mode): fall back to the default.
    document.documentElement.setAttribute('data-theme', DEFAULT_THEME);
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="min-h-screen font-sans">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
