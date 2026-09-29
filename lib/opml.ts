import { generateOpml, parseOpml } from 'feedsmith';

export interface OpmlFeedEntry {
  xmlUrl: string;
  title: string | null;
  htmlUrl: string | null;
  description: string | null;
}

/** Builds a standards-compliant OPML 2.0 document of the current feeds. */
export function buildOpml(
  feeds: Array<{
    url: string;
    title: string | null;
    siteUrl: string | null;
    description: string | null;
  }>,
  title = 'RSS Reader subscriptions',
): string {
  return generateOpml({
    head: {
      title,
      dateCreated: new Date(),
      dateModified: new Date(),
    },
    body: {
      outlines: feeds
        .slice()
        .sort((a, b) => (a.title ?? a.url).localeCompare(b.title ?? b.url))
        .map((feed) => ({
          text: feed.title ?? feed.url,
          title: feed.title ?? feed.url,
          type: 'rss',
          xmlUrl: feed.url,
          ...(feed.siteUrl ? { htmlUrl: feed.siteUrl } : {}),
          ...(feed.description ? { description: feed.description } : {}),
        })),
    },
  });
}

/** Flattens an OPML tree, collecting every outline that names a feed URL. */
export function parseOpmlFeeds(document: string): OpmlFeedEntry[] {
  const parsed = parseOpml(document);
  const found: OpmlFeedEntry[] = [];
  const seen = new Set<string>();

  const walk = (outlines: unknown) => {
    if (!Array.isArray(outlines)) return;

    for (const outline of outlines) {
      if (!outline || typeof outline !== 'object') continue;
      const node = outline as {
        xmlUrl?: unknown;
        url?: unknown;
        text?: unknown;
        title?: unknown;
        htmlUrl?: unknown;
        description?: unknown;
        outlines?: unknown;
      };

      // Some exporters use `url` instead of the standard `xmlUrl`.
      const candidate = node.xmlUrl ?? node.url;
      if (typeof candidate === 'string') {
        const url = candidate.trim();
        if (url && !seen.has(url)) {
          seen.add(url);
          const label =
            (typeof node.title === 'string' && node.title.trim()) ||
            (typeof node.text === 'string' && node.text.trim()) ||
            null;
          found.push({
            xmlUrl: url,
            title: label || null,
            htmlUrl: typeof node.htmlUrl === 'string' ? node.htmlUrl : null,
            description: typeof node.description === 'string' ? node.description : null,
          });
        }
      }

      // Category folders nest their children; recurse regardless.
      walk(node.outlines);
    }
  };

  walk(parsed.body?.outlines);
  return found;
}
