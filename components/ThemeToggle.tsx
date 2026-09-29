'use client';

import { useEffect, useState } from 'react';

export type Theme = 'light' | 'sepia' | 'dark';

const ORDER: Theme[] = ['light', 'sepia', 'dark'];

const LABELS: Record<Theme, { icon: string; title: string }> = {
  light: { icon: '☀', title: 'Light theme — click for sepia reading mode' },
  sepia: { icon: '📖', title: 'Sepia reading mode (the default) — click for dark' },
  dark: { icon: '☾', title: 'Dark theme — click for light' },
};

/** The app default, matching the bootstrap script in app/layout.tsx. */
const DEFAULT_THEME: Theme = 'sepia';

export function ThemeToggle() {
  // Initialised to the default so the first render matches the DOM the
  // bootstrap script already styled.
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Read the attribute the bootstrap script just set, rather than storage,
    // so the migration it performed is already accounted for.
    const current = document.documentElement.getAttribute('data-theme');
    if (current === 'dark' || current === 'light' || current === 'sepia') setTheme(current);
    else setTheme(DEFAULT_THEME);
    setMounted(true);
  }, []);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('rss-theme', next);
    } catch {
      // Private mode: the theme just will not persist.
    }
  }

  return (
    <button
      type="button"
      onClick={cycle}
      title={LABELS[theme].title}
      aria-label={`Theme: ${theme}. Click to change.`}
      className="rounded-md border px-2 py-1.5 text-sm transition app-border app-text-muted hover:app-muted"
    >
      {/* Match the default icon until mounted to avoid a visible swap. */}
      {mounted ? LABELS[theme].icon : LABELS[DEFAULT_THEME].icon}
    </button>
  );
}
