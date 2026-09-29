import { NextResponse } from 'next/server';
import { extractArticleText, serializeArticle } from '@/lib/articles';
import { isProxyConfigured } from '@/lib/extract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Extraction fetches and parses a full web page.
export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

/**
 * Fetches the full article text from its source page and stores it.
 *
 * Body (optional): { force?: boolean }
 *   force re-extracts even when a previous extraction succeeded.
 */
export async function POST(request: Request, context: Context) {
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid article id' }, { status: 400 });
  }

  let force = false;
  const raw = await request.text();
  if (raw.trim()) {
    try {
      const body = JSON.parse(raw) as { force?: unknown };
      force = body.force === true;
    } catch {
      return NextResponse.json({ error: 'Malformed JSON body' }, { status: 400 });
    }
  }

  const outcome = await extractArticleText(id, { force });

  if (!outcome) {
    return NextResponse.json({ error: 'Article not found' }, { status: 404 });
  }

  const article = serializeArticle(outcome.article);

  if (!outcome.ok) {
    // 422 rather than 500: the request was fine, the page could not be read.
    return NextResponse.json(
      {
        ok: false,
        error: outcome.error ?? 'Could not extract the article text',
        article,
        proxyConfigured: isProxyConfigured(),
      },
      { status: 422 },
    );
  }

  return NextResponse.json({ ok: true, article, proxyConfigured: isProxyConfigured() });
}
