import sanitizeHtml from 'sanitize-html';
import { parseFeed } from 'feedsmith';
import type { AnyFeed } from 'feedsmith';

/** A feed item normalized to a single shape across RSS / Atom / RDF / JSON Feed. */
export interface NormalizedItem {
  guid: string;
  title: string | null;
  link: string | null;
  author: string | null;
  /** Sanitized HTML, or null when the item has no body. */
  content: string | null;
  /** Plain text (never HTML) for previews. */
  summary: string | null;
  publishedAt: Date | null;
}

export interface NormalizedFeed {
  format: AnyFeed['format'];
  title: string | null;
  siteUrl: string | null;
  description: string | null;
  items: NormalizedItem[];
}

/**
 * Feed HTML is untrusted input from third parties: it is rendered with
 * dangerouslySetInnerHTML, so everything passes through here first. Scripts,
 * iframes, event handlers, and javascript: URLs are dropped; images/links are
 * kept since RSS bodies legitimately contain them.
 */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr', 'blockquote', 'pre', 'code',
    'b', 'strong', 'i', 'em', 'u', 's', 'sub', 'sup', 'mark', 'small',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'a', 'img', 'figure', 'figcaption', 'picture', 'source',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
    'div', 'span', 'section', 'article', 'aside',
    'audio', 'video', 'details', 'summary',
  ],
  allowedAttributes: {
    a: ['href', 'title'],
    img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading'],
    source: ['src', 'srcset', 'type', 'media'],
    audio: ['src', 'controls', 'preload'],
    video: ['src', 'controls', 'poster', 'width', 'height', 'preload'],
    '*': ['colspan', 'rowspan', 'start', 'reversed', 'value'],
  },
  // Blocks javascript:, data:, vbscript: and similar payloads in href/src.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    // Never leak the referrer or hand the opener to the destination page.
    a: sanitizeHtml.simpleTransform('a', {
      rel: 'noopener noreferrer nofollow',
      target: '_blank',
    }),
  },
};

export function sanitizeContent(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/** Collapses whitespace and strips tags, for plain-text previews. */
export function toPlainText(input: string | null | undefined): string | null {
  if (!input) return null;
  const text = sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0 ? text : null;
}

function text(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  // Atom text constructs: { value, type }
  if (value && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value?: unknown }).value;
    if (typeof inner === 'string') {
      const trimmed = inner.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }
  return null;
}

function firstLink(links: unknown): string | null {
  if (!Array.isArray(links)) return null;
  const candidates = links.filter(
    (l): l is { href?: unknown; rel?: unknown } => typeof l === 'object' && l !== null,
  );
  // Prefer the canonical alternate link, then anything with an href.
  const alternate = candidates.find((l) => l.rel === 'alternate' || l.rel === undefined);
  const chosen = alternate ?? candidates[0];
  return chosen ? (text(chosen.href) ?? null) : null;
}

/** Handles both ISO strings and epoch seconds/ms. Returns null when unparseable. */
function parseDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Epoch values below this threshold are seconds, not milliseconds.
    const ms = value < 100_000_000_000 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Stable dedup key for items that ship neither a guid nor a link. */
function fallbackGuid(item: { title?: string | null; publishedAt?: Date | null }): string {
  const seed = `${item.title ?? ''}|${item.publishedAt?.toISOString() ?? ''}`;
  // Small, dependency-free hash. Collisions only matter within one feed.
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `generated:${(hash >>> 0).toString(16)}`;
}

function normalizeCommon(item: {
  guid: string | null;
  title: string | null;
  link: string | null;
  author: string | null;
  content: string | null;
  summary: string | null;
  publishedAt: Date | null;
}): NormalizedItem {
  // Prefer real HTML content; fall back to the plain-text summary so the
  // reader always has something to show.
  const html = item.content ? sanitizeContent(item.content) : null;

  return {
    guid: item.guid ?? fallbackGuid({ title: item.title, publishedAt: item.publishedAt }),
    title: item.title,
    link: item.link,
    author: item.author,
    content: html,
    summary: item.summary ?? toPlainText(html) ?? toPlainText(item.title),
    publishedAt: item.publishedAt,
  };
}

/**
 * Parses a feed document and normalizes it. Throws on unparseable input.
 * `format` is reported so the caller can log which dialect was detected.
 */
export function normalizeFeed(document: string | Buffer): NormalizedFeed {
  // Parse dates into Date objects up front rather than raw strings.
  const parsed = parseFeed<Date>(document);
  const { format, feed } = parsed;

  if (format === 'json') {
    const json = feed as Extract<AnyFeed<Date>, { format: 'json' }>['feed'];
    return {
      format,
      title: text(json.title),
      siteUrl: text(json.home_page_url),
      description: text(json.description),
      items: (json.items ?? []).map((item) =>
        normalizeCommon({
          guid: text(item.id),
          title: text(item.title),
          link: text(item.url) ?? text(item.external_url),
          author: text(item.authors?.[0]?.name),
          content: text(item.content_html) ?? text(item.content_text),
          summary: text(item.summary) ?? text(item.content_text),
          publishedAt: parseDate(item.date_published),
        }),
      ),
    };
  }

  if (format === 'atom') {
    const atom = feed as Extract<AnyFeed<Date>, { format: 'atom' }>['feed'];
    return {
      format,
      title: text(atom.title),
      siteUrl: firstLink(atom.links),
      description: text(atom.subtitle),
      items: (atom.entries ?? []).map((entry) =>
        normalizeCommon({
          guid: text(entry.id),
          title: text(entry.title),
          link: firstLink(entry.links),
          author: text(entry.authors?.[0]?.name),
          content: text(entry.content?.value),
          summary: text(entry.summary),
          // published is the first-release date; updated is the fallback for
          // feeds that only set updated.
          publishedAt: parseDate(entry.published) ?? parseDate(entry.updated),
        }),
      ),
    };
  }

  // RSS and RDF share the same item shape (content:encoded / description).
  const rss = feed as Extract<AnyFeed<Date>, { format: 'rss' | 'rdf' }>['feed'];
  const feedLink = text((rss as { link?: unknown }).link);

  return {
    format,
    title: text(rss.title),
    siteUrl: feedLink ?? firstLink((rss as { atom?: { links?: unknown } }).atom?.links),
    description: text((rss as { description?: unknown }).description),
    items: (rss.items ?? []).map((item) => {
      const entry = item as {
        title?: unknown;
        link?: unknown;
        description?: unknown;
        authors?: Array<{ name?: unknown }>;
        dc?: { creator?: unknown };
        guid?: { value?: unknown };
        pubDate?: unknown;
        dcDate?: unknown;
        content?: { encoded?: unknown };
        atom?: { links?: unknown; content?: { value?: unknown } };
      };

      return normalizeCommon({
        guid: text(entry.guid?.value) ?? text(entry.link),
        title: text(entry.title),
        link:
          text(entry.link) ??
          firstLink(entry.atom?.links) ??
          null,
        author: text(entry.authors?.[0]?.name) ?? text(entry.dc?.creator),
        // content:encoded holds the full body; description is usually a summary.
        content: text(entry.content?.encoded) ?? text(entry.atom?.content?.value),
        summary: text(entry.description),
        publishedAt: parseDate(entry.pubDate),
      });
    }),
  };
}

/** Metadata-only parse, used when adding a single feed by URL. */
export function parseFeedMetadata(document: string | Buffer): {
  title: string | null;
  siteUrl: string | null;
  description: string | null;
  format: AnyFeed['format'];
} {
  const normalized = normalizeFeed(document);
  return {
    title: normalized.title,
    siteUrl: normalized.siteUrl,
    description: normalized.description,
    format: normalized.format,
  };
}
