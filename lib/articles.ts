import 'server-only';

import { eq } from 'drizzle-orm';
import { getDb, schema } from './db';
import { extractArticle, buildFetchTarget, getProxyHeaders } from './extract';
import { sanitizeContent } from './parser';

/** A single article with everything the reader view needs. */
export interface ArticleDetail {
  id: number;
  feedId: number;
  feedTitle: string | null;
  feedSiteUrl: string | null;
  title: string | null;
  link: string | null;
  author: string | null;
  summary: string | null;
  content: string | null;
  extractedContent: string | null;
  extractedAt: Date | null;
  extractedByline: string | null;
  extractionError: string | null;
  publishedAt: Date | null;
  isRead: boolean;
}

export async function loadArticle(id: number): Promise<ArticleDetail | null> {
  const db = await getDb();
  const rows = await db
    .select({
      id: schema.articles.id,
      feedId: schema.articles.feedId,
      title: schema.articles.title,
      link: schema.articles.link,
      author: schema.articles.author,
      summary: schema.articles.summary,
      content: schema.articles.content,
      extractedContent: schema.articles.extractedContent,
      extractedAt: schema.articles.extractedAt,
      extractedByline: schema.articles.extractedByline,
      extractionError: schema.articles.extractionError,
      publishedAt: schema.articles.publishedAt,
      isRead: schema.articles.isRead,
      feedTitle: schema.feeds.title,
      feedSiteUrl: schema.feeds.siteUrl,
    })
    .from(schema.articles)
    .innerJoin(schema.feeds, eq(schema.feeds.id, schema.articles.feedId))
    .where(eq(schema.articles.id, id))
    .limit(1);

  return rows[0] ?? null;
}

export interface ExtractedArticle {
  /** Sanitized HTML actually shown, preferring the extracted body. */
  content: string | null;
  isExtracted: boolean;
  textLength: number;
}

/** Shape returned to the client by the article endpoints. */
export interface SerializedArticle {
  id: number;
  feedId: number;
  feedTitle: string | null;
  feedSiteUrl: string | null;
  title: string | null;
  link: string | null;
  author: string | null;
  summary: string | null;
  content: string | null;
  publishedAt: string | null;
  isRead: boolean;
  /** True when `content` came from full-text extraction rather than the feed. */
  isExtracted: boolean;
  extractedAt: string | null;
  extractionError: string | null;
}

/**
 * Chooses what the reader should render. Extracted text wins when present;
 * otherwise the feed body is used. Null content means the feed only carried a
 * summary, letting the client offer extraction.
 */
export function resolveArticleContent(article: ArticleDetail): ExtractedArticle {
  if (article.extractedContent) {
    return {
      content: article.extractedContent,
      isExtracted: true,
      textLength: article.extractedContent.length,
    };
  }

  return {
    content: article.content,
    isExtracted: false,
    textLength: article.content?.length ?? 0,
  };
}

export function serializeArticle(article: ArticleDetail): SerializedArticle {
  const resolved = resolveArticleContent(article);
  return {
    id: article.id,
    feedId: article.feedId,
    feedTitle: article.feedTitle,
    feedSiteUrl: article.feedSiteUrl,
    title: article.title,
    link: article.link,
    // The source page's byline is often richer than the feed's author field.
    author: article.extractedByline ?? article.author,
    summary: article.summary,
    content: resolved.content,
    publishedAt: article.publishedAt?.toISOString() ?? null,
    isRead: Boolean(article.isRead),
    isExtracted: resolved.isExtracted,
    extractedAt: article.extractedAt?.toISOString() ?? null,
    extractionError: article.extractionError,
  };
}

export interface ExtractionOutcome {
  ok: boolean;
  error?: string;
  article: ArticleDetail;
}

/**
 * Fetches and stores the full article text for one article.
 *
 * `force` re-extracts even when a previous attempt succeeded. Failures are
 * recorded on the row so the reader can show why, but never clear existing
 * extracted content — a transient network error should not lose the text you
 * already have.
 */
export async function extractArticleText(
  articleId: number,
  options: { force?: boolean; linkOverride?: string } = {},
): Promise<ExtractionOutcome | null> {
  const article = await loadArticle(articleId);
  if (!article) return null;

  if (article.extractedContent && !options.force) {
    return { ok: true, article };
  }

  const target = options.linkOverride?.trim() || article.link;
  if (!target) {
    const db = await getDb();
    const message = 'This article has no link to fetch the full text from.';
    await db
      .update(schema.articles)
      .set({ extractionError: message, extractedAt: new Date() })
      .where(eq(schema.articles.id, articleId));
    return { ok: false, error: message, article: (await loadArticle(articleId))! };
  }

  const result = await extractArticle(target);
  const db = await getDb();

  if (!result.ok) {
    await db
      .update(schema.articles)
      .set({ extractionError: result.error, extractedAt: new Date() })
      .where(eq(schema.articles.id, articleId));
    return {
      ok: false,
      error: result.error,
      article: (await loadArticle(articleId))!,
    };
  }

  // Re-sanitize on write: the extraction pipeline already sanitized, but this
  // keeps a single choke point for anything rendered as HTML.
  await db
    .update(schema.articles)
    .set({
      extractedContent: sanitizeContent(result.content),
      extractedAt: new Date(),
      extractedByline: result.byline,
      extractionError: null,
    })
    .where(eq(schema.articles.id, articleId));

  return { ok: true, article: (await loadArticle(articleId))! };
}

export { buildFetchTarget, getProxyHeaders };
