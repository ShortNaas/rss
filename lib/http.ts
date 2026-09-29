/**
 * HTTP fetching with conditional GET, so a feed that has not changed costs
 * almost nothing: the server replies 304 and we skip parsing entirely.
 */

export const USER_AGENT =
  'rss-reader/0.1 (+https://github.com/; personal feed reader)';

/**
 * Article pages are frequently served a stripped-down shell to unknown
 * clients, so full-text extraction requests a normal browser UA.
 */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export interface FetchConditionalOptions {
  etag?: string | null;
  lastModified?: string | null;
  timeoutMs?: number;
  maxBytes?: number;
  /** Overrides the default feed-reader User-Agent. */
  userAgent?: string;
  /** Extra request headers, e.g. an X-Proxy-Secret for a fetch proxy. */
  extraHeaders?: Record<string, string>;
  /** Overrides the Accept header. */
  accept?: string;
  /**
   * Attempts for transient failures (connection errors, 5xx, 429).
   * Defaults to 1. The interactive add-feed path opts into more; the bulk
   * refresh keeps one attempt so a dead host is not retried 50 times.
   */
  retryAttempts?: number;
  /** Base delay between retries, in ms. */
  retryDelayMs?: number;
}

export type FetchFeedResult =
  | {
      status: 'ok';
      body: string;
      etag: string | null;
      lastModified: string | null;
      /** Set when the response was larger than maxBytes and was discarded. */
      truncated: boolean;
      finalUrl: string;
    }
  | { status: 'not-modified'; etag: string | null; lastModified: string | null }
  | { status: 'error'; error: string };

/**
 * Streams the response and aborts once maxBytes is exceeded, so one enormous
 * feed cannot exhaust the function's memory.
 */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const body = response.body;
  if (!body) return { text: await response.text(), truncated: false };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { text: '', truncated: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { text: new TextDecoder('utf-8').decode(merged), truncated: false };
}

/** HTTP statuses worth retrying: transient server-side or rate limiting. */
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function fetchFeedDocument(
  url: string,
  options: FetchConditionalOptions = {},
): Promise<FetchFeedResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const attempts = Math.max(1, options.retryAttempts ?? 1);
  const retryDelayMs = options.retryDelayMs ?? 400;

  const headers: Record<string, string> = {
    'user-agent': options.userAgent ?? USER_AGENT,
    accept:
      options.accept ??
      'application/feed+json, application/atom+xml, application/rss+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8',
    'accept-encoding': 'gzip, deflate',
    ...options.extraHeaders,
  };
  if (options.etag) headers['if-none-match'] = options.etag;
  if (options.lastModified) headers['if-modified-since'] = options.lastModified;

  let lastError = 'Unknown error';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // A fresh controller per attempt: once aborted, a signal stays aborted.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const isLastAttempt = attempt === attempts;

    try {
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
        redirect: 'follow',
        cache: 'no-store',
      });

      if (response.status === 304) {
        return {
          status: 'not-modified',
          etag: response.headers.get('etag') ?? options.etag ?? null,
          lastModified: response.headers.get('last-modified') ?? options.lastModified ?? null,
        };
      }

      if (!response.ok) {
        lastError = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
        // Retry only genuinely transient responses; a 404 will never succeed.
        if (TRANSIENT_STATUSES.has(response.status) && !isLastAttempt) {
          await delay(retryDelayMs * attempt);
          continue;
        }
        return { status: 'error', error: lastError };
      }

      const { text, truncated } = await readCapped(response, maxBytes);

      return {
        status: 'ok',
        body: text,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        truncated,
        finalUrl: response.url || url,
      };
    } catch (error) {
      // Connection resets, DNS blips and timeouts are worth one more try.
      lastError =
        error instanceof Error && error.name === 'AbortError'
          ? `Timed out after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error);

      if (!isLastAttempt) {
        await delay(retryDelayMs * attempt);
        continue;
      }
      return { status: 'error', error: lastError };
    } finally {
      clearTimeout(timer);
    }
  }

  return { status: 'error', error: lastError };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Expands a bare domain into its feed URL by looking for
 * `<link rel="alternate" type="application/rss+xml">` in the HTML.
 * Returns null when nothing feed-shaped is found.
 */
export async function discoverFeedUrl(
  pageUrl: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string | null> {
  const result = await fetchFeedDocument(pageUrl, { timeoutMs, maxBytes: 2 * 1024 * 1024 });
  if (result.status !== 'ok') return null;

  const linkTags = result.body.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    if (!/rel\s*=\s*["']?alternate/i.test(tag)) continue;
    if (!/type\s*=\s*["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      return new URL(href, result.finalUrl).toString();
    } catch {
      continue;
    }
  }

  // Common conventional locations as a fallback.
  for (const path of ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml']) {
    try {
      const candidate = new URL(path, result.finalUrl).toString();
      const probe = await fetchFeedDocument(candidate, { timeoutMs, maxBytes: 256 * 1024 });
      if (probe.status === 'ok' && looksLikeFeed(probe.body)) return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

/** Cheap sniff of the document root, used before committing to a full parse. */
export function looksLikeFeed(body: string): boolean {
  const head = body.slice(0, 2000);
  return (
    /<rss[\s>]/i.test(head) ||
    /<feed[\s>]/i.test(head) ||
    /<rdf:RDF[\s>]/i.test(head) ||
    /"version"\s*:\s*"https:\/\/jsonfeed\.org/i.test(head)
  );
}

/** Adds https:// to bare input and rejects anything that is not http(s). */
export function normalizeFeedUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Feed URL is required');

  // Detect ANY scheme, not just http(s). Prefixing "https://" onto input that
  // already carries a scheme produces a URL that parses but is nonsense
  // (https://ftp://example.com/feed), which would then be fetched verbatim.
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const withScheme = hasScheme ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error(`Not a valid URL: ${input}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https feed URLs are supported');
  }

  return parsed.toString();
}
