import 'server-only';

import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { BROWSER_USER_AGENT, fetchFeedDocument } from './http';
import { sanitizeContent, toPlainText } from './parser';
import { assertFetchableUrl, isBlockedHost } from './urlSafety.mjs';

/**
 * Full-text extraction.
 *
 * Many feeds (BBC, Hacker News) publish only a one-line `description` rather
 * than the article body, so the reader would otherwise show a teaser. When a
 * feed does not carry the text, the article page itself is fetched and
 * Mozilla's Readability pulls the main content out of it.
 */

export interface ExtractionSuccess {
  ok: true;
  /** Sanitized HTML of the article body, ready to render. */
  content: string;
  /** Plain-text length, used to decide whether extraction was worthwhile. */
  textLength: number;
  /** Character count of the rendered HTML. */
  htmlLength: number;
  title: string | null;
  byline: string | null;
  /** Published site name from OpenGraph/JSON-LD, when Readability found one. */
  siteName: string | null;
}

export interface ExtractionFailure {
  ok: false;
  error: string;
  /** True when re-trying later has a reasonable chance of succeeding. */
  retryable: boolean;
}

export type ExtractionResult = ExtractionSuccess | ExtractionFailure;

export { isBlockedHost, assertFetchableUrl };

/** Optional fetch-proxy credentials, read from the environment. */
export function getProxyHeaders(): Record<string, string> {
  const secret = process.env.PROXY_SECRET;
  if (!secret) return {};

  return {
    'x-proxy-secret': secret,
    ...(process.env.PROXY_AUTH ? { 'x-proxy-auth': process.env.PROXY_AUTH } : {}),
  };
}

export function isProxyConfigured(): boolean {
  return Boolean(process.env.PROXY_BASE_URL);
}

/**
 * Rewrites the request through a static-IP fetch proxy when one is configured.
 * Serverless egress IPs are frequently blocked by news sites, so this is the
 * escape hatch; without PROXY_BASE_URL the request goes out directly.
 */
export function buildFetchTarget(url: string): string {
  const base = process.env.PROXY_BASE_URL;
  if (!base) return url;
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${trimmed}/${url}`;
}

/**
 * Fetches an article page and extracts its main content.
 * Never throws: failures come back as `{ ok: false }`.
 */
export async function extractArticle(
  articleUrl: string,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<ExtractionResult> {
  let url: URL;
  try {
    url = assertFetchableUrl(articleUrl);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Invalid article URL',
      retryable: false,
    };
  }

  const response = await fetchFeedDocument(buildFetchTarget(url.toString()), {
    timeoutMs: options.timeoutMs ?? 20_000,
    maxBytes: options.maxBytes ?? 4 * 1024 * 1024,
    userAgent: BROWSER_USER_AGENT,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    extraHeaders: getProxyHeaders(),
  });

  if (response.status === 'error') {
    return { ok: false, error: `Could not fetch the article: ${response.error}`, retryable: true };
  }
  if (response.status === 'not-modified') {
    // No conditional headers were sent, so this is a server quirk.
    return { ok: false, error: 'The site returned 304 Not Modified', retryable: true };
  }
  if (response.truncated) {
    return { ok: false, error: 'The article page was too large to process', retryable: false };
  }

  // A non-HTML response (PDF, image, JSON error page) cannot be extracted.
  if (!/<html|<!doctype|<body|<article/i.test(response.body.slice(0, 4000))) {
    return {
      ok: false,
      error: 'That link did not return an HTML page',
      retryable: false,
    };
  }

  return extractFromHtml(response.body, response.finalUrl || url.toString());
}

/** Runs Readability over an HTML document and sanitizes the result. */
export function extractFromHtml(html: string, baseUrl: string): ExtractionResult {
  let article: ReturnType<Readability['parse']> = null;

  try {
    // linkedom provides the DOM that Readability needs without pulling in a
    // full browser environment.
    const { document } = parseHTML(html);

    // Readability resolves relative href/src against the document URL.
    try {
      Object.defineProperty(document, 'baseURI', { value: baseUrl, configurable: true });
    } catch {
      // Not fatal: absolute URLs in the source still work.
    }

    const reader = new Readability(document as unknown as Document, {
      // Some sites split a short intro from the body; a low threshold keeps
      // those articles rather than discarding them.
      charThreshold: 100,
      keepClasses: false,
    });
    article = reader.parse();
  } catch (error) {
    return {
      ok: false,
      error: `Could not parse the page: ${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
    };
  }

  if (!article?.content) {
    return {
      ok: false,
      error: 'Could not find the article text on that page — it may be paywalled or script-rendered.',
      retryable: false,
    };
  }

  // Sanitized with the same policy as feed HTML, since this is equally
  // untrusted input rendered via dangerouslySetInnerHTML.
  const content = sanitizeContent(article.content);
  const text = toPlainText(content) ?? '';

  if (text.length < 200) {
    return {
      ok: false,
      error: 'The extracted text was too short to be the article body.',
      retryable: false,
    };
  }

  return {
    ok: true,
    content,
    textLength: text.length,
    htmlLength: content.length,
    title: article.title?.trim() || null,
    byline: article.byline?.trim() || null,
    siteName: article.siteName?.trim() || null,
  };
}
