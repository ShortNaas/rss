import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { normalizeFeedUrl } from '@/lib/http';
import { parseOpmlFeeds } from '@/lib/opml';
import { refreshFeeds } from '@/lib/refresh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_IMPORT = 500;

interface ImportOutcome {
  url: string;
  title: string | null;
  status: 'added' | 'duplicate' | 'invalid';
  detail?: string;
}

/**
 * Imports an OPML document. Accepts either multipart/form-data with a `file`
 * field or a raw XML body.
 *
 * Body: { dryRun?: boolean } via query string `?dryRun=true` to preview.
 */
export async function POST(request: Request) {
  const dryRun = ['true', '1'].includes(
    (new URL(request.url).searchParams.get('dryRun') ?? '').toLowerCase(),
  );

  let document = '';
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file') ?? form.get('opml');
      if (file instanceof File) document = await file.text();
      else if (typeof file === 'string') document = file;
    } else {
      document = await request.text();
    }
  } catch {
    return NextResponse.json({ error: 'Could not read the uploaded file' }, { status: 400 });
  }

  if (!document.trim()) {
    return NextResponse.json({ error: 'No OPML content received' }, { status: 400 });
  }

  let entries: ReturnType<typeof parseOpmlFeeds>;
  try {
    entries = parseOpmlFeeds(document);
  } catch (error) {
    return NextResponse.json(
      { error: `Not a valid OPML file: ${error instanceof Error ? error.message : String(error)}` },
      { status: 422 },
    );
  }

  if (entries.length === 0) {
    return NextResponse.json(
      { error: 'No subscriptions (xmlUrl) found in that OPML file' },
      { status: 422 },
    );
  }

  const db = await getDb();
  const existing = await db.select({ url: schema.feeds.url }).from(schema.feeds);
  const known = new Set(existing.map((row) => row.url));

  const outcomes: ImportOutcome[] = [];
  const toAdd: Array<{ url: string; title: string | null; htmlUrl: string | null }> = [];

  for (const entry of entries.slice(0, MAX_IMPORT)) {
    let url: string;
    try {
      url = normalizeFeedUrl(entry.xmlUrl);
    } catch (error) {
      outcomes.push({
        url: entry.xmlUrl,
        title: entry.title,
        status: 'invalid',
        detail: error instanceof Error ? error.message : 'Invalid URL',
      });
      continue;
    }

    if (known.has(url)) {
      outcomes.push({ url, title: entry.title, status: 'duplicate' });
      continue;
    }

    known.add(url);
    toAdd.push({ url, title: entry.title, htmlUrl: entry.htmlUrl });
    outcomes.push({ url, title: entry.title, status: 'added' });
  }

  const truncated = entries.length > MAX_IMPORT;

  if (dryRun || toAdd.length === 0) {
    // Same response shape as the import path so clients can parse either.
    return NextResponse.json({
      dryRun: true,
      found: entries.length,
      truncated,
      imported: 0,
      added: toAdd.length,
      duplicates: outcomes.filter((o) => o.status === 'duplicate').length,
      invalid: outcomes.filter((o) => o.status === 'invalid').length,
      fetched: null,
      outcomes,
    });
  }

  const inserted = await db
    .insert(schema.feeds)
    .values(
      toAdd.map((entry) => ({
        url: entry.url,
        title: entry.title ?? entry.url,
        siteUrl: entry.htmlUrl,
      })),
    )
    .onConflictDoNothing({ target: schema.feeds.url })
    .returning({ id: schema.feeds.id });

  // Fetch the new subscriptions in one pass, respecting the refresh budget.
  const report = inserted.length > 0
    ? await refreshFeeds({ feedIds: inserted.map((row) => row.id) })
    : null;

  return NextResponse.json({
    found: entries.length,
    truncated,
    imported: inserted.length,
    duplicates: outcomes.filter((o) => o.status === 'duplicate').length,
    invalid: outcomes.filter((o) => o.status === 'invalid').length,
    fetched: report
      ? { inserted: report.inserted, failed: report.failed, skipped: report.skipped }
      : null,
    outcomes,
  });
}
