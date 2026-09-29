'use client';

/**
 * Reader preferences, persisted in localStorage.
 *
 * These are per-browser rather than per-account: this is a single-user app, and
 * the proxy secret in particular should stay on the machine using it.
 */
export interface ReaderPrefs {
  fontSize: 'sm' | 'md' | 'lg';
  /**
   * When true, opening an article whose feed carried only a short summary
   * automatically fetches the full text from the source page.
   */
  autoExtract: boolean;
  /**
   * Optional shared secret sent as `x-proxy-secret` on extraction requests,
   * for use with a self-hosted fetch proxy configured via PROXY_BASE_URL.
   */
  proxySecret: string;
}

const STORAGE_KEY = 'rss-reader-prefs';

export const DEFAULT_READER_PREFS: ReaderPrefs = {
  fontSize: 'md',
  autoExtract: true,
  proxySecret: '',
};

export function loadReaderPrefs(): ReaderPrefs {
  if (typeof window === 'undefined') return DEFAULT_READER_PREFS;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_READER_PREFS;

    const parsed = JSON.parse(raw) as Partial<ReaderPrefs>;
    return {
      fontSize:
        parsed.fontSize === 'sm' || parsed.fontSize === 'lg' || parsed.fontSize === 'md'
          ? parsed.fontSize
          : DEFAULT_READER_PREFS.fontSize,
      autoExtract:
        typeof parsed.autoExtract === 'boolean'
          ? parsed.autoExtract
          : DEFAULT_READER_PREFS.autoExtract,
      proxySecret: typeof parsed.proxySecret === 'string' ? parsed.proxySecret : '',
    };
  } catch {
    return DEFAULT_READER_PREFS;
  }
}

export function saveReaderPrefs(prefs: ReaderPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode: preferences simply will not persist.
  }
}
