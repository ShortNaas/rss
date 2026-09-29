import { NextResponse } from 'next/server';
import { loadArticle, serializeArticle } from '@/lib/articles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** A single article with its full content, used by the reader view. */
export async function GET(_request: Request, context: Context) {
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid article id' }, { status: 400 });
  }

  const article = await loadArticle(id);
  if (!article) {
    return NextResponse.json({ error: 'Article not found' }, { status: 404 });
  }

  return NextResponse.json({ article: serializeArticle(article) });
}
