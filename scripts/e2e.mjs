/**
 * End-to-end check against a running dev server.
 *
 * Usage: node scripts/e2e.mjs [baseUrl] [password]
 * Requires APP_PASSWORD to be set on the server (default 'test-pw-123').
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const PASSWORD = process.argv[3] ?? 'test-pw-123';

let cookie = '';
let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  if (options.json !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
    redirect: 'manual',
  });

  const setCookie = response.headers.getSetCookie?.() ?? [];
  for (const entry of setCookie) {
    if (entry.startsWith('rss_session=')) cookie = entry.split(';')[0];
  }

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text.slice(0, 200);
  }
  return { status: response.status, body, headers: response.headers };
}

console.log(`\nRSS Reader end-to-end check against ${BASE}\n`);

// --- auth ------------------------------------------------------------------
console.log('auth');
{
  const unauth = await call('/api/feeds');
  check('unauthenticated API is rejected', unauth.status === 401, `got ${unauth.status}`);

  const wrong = await call('/api/auth/login', { method: 'POST', json: { password: 'wrong' } });
  check('wrong password rejected', wrong.status === 401, `got ${wrong.status}`);

  const login = await call('/api/auth/login', { method: 'POST', json: { password: PASSWORD } });
  check('correct password accepted', login.status === 200 && login.body?.ok === true);
  check('session cookie issued', cookie.startsWith('rss_session='));
}

// --- feeds -----------------------------------------------------------------
console.log('\nfeeds');
let feeds = [];
{
  const list = await call('/api/feeds');
  check('GET /api/feeds works when authenticated', list.status === 200);
  feeds = list.body?.feeds ?? [];

  // The suite must work on an empty database too, so seed a real feed when
  // there are not enough to test with.
  const seedUrls = [
    'https://hnrss.org/frontpage',
    'https://feeds.bbci.co.uk/news/rss.xml',
  ];
  for (const url of seedUrls) {
    if (feeds.some((feed) => feed.url === url)) continue;
    if (feeds.length >= 2) break;
    const seeded = await call('/api/feeds', { method: 'POST', json: { url } });
    if (seeded.status === 201) {
      console.log(`  SEED  added ${url} (${seeded.body.added} articles)`);
    } else {
      console.log(`  WARN  could not seed ${url}: HTTP ${seeded.status}`);
    }
  }

  const refreshed = await call('/api/feeds');
  feeds = refreshed.body?.feeds ?? [];

  check('feeds are listed', feeds.length >= 2, `${feeds.length} feed(s)`);
  check(
    'unread counts are present',
    feeds.every((f) => typeof f.unread === 'number'),
  );
  check(
    'each feed reports a folderId field',
    feeds.every((f) => 'folderId' in f && 'tags' in f),
  );

  if (feeds.length > 0) {
    const duplicate = await call('/api/feeds', {
      method: 'POST',
      json: { url: feeds[0].url },
    });
    check('duplicate feed rejected with 409', duplicate.status === 409, `got ${duplicate.status}`);
  }

  const invalid = await call('/api/feeds', { method: 'POST', json: { url: 'not a url at all' } });
  check('invalid feed URL rejected', invalid.status === 400 || invalid.status === 422, `got ${invalid.status}`);

  const notAFeed = await call('/api/feeds', {
    method: 'POST',
    json: { url: 'https://example.com/' },
  });
  check('non-feed URL rejected', notAFeed.status === 422, `got ${notAFeed.status}`);
}

// --- articles & pagination -------------------------------------------------
console.log('\narticles');
let firstArticle = null;
{
  const page1 = await call('/api/articles?limit=5');
  check('articles are returned', page1.status === 200 && page1.body.articles.length > 0);
  check('pagination reports totals', typeof page1.body.total === 'number', `total=${page1.body.total}`);
  check('limit is honoured', page1.body.articles.length <= 5);
  check('hasMore is set when more remain', page1.body.hasMore === true);
  firstArticle = page1.body.articles[0];

  const page2 = await call('/api/articles?limit=5&offset=5');
  const ids1 = page1.body.articles.map((a) => a.id);
  const ids2 = page2.body.articles.map((a) => a.id);
  check('offset pages do not overlap', ids1.every((id) => !ids2.includes(id)));

  const leaked = JSON.stringify(page1.body);
  check('internal fields are not exposed', !leaked.includes('etag') && !leaked.includes('search_vector'));

  const filtered = await call(`/api/articles?feedId=${feeds[0].id}&limit=50`);
  check(
    'feedId filter works',
    filtered.body.articles.every((a) => a.feedId === feeds[0].id),
  );
}

// --- read state ------------------------------------------------------------
console.log('\nread state');
{
  const markRead = await call(`/api/articles/${firstArticle.id}/read`, {
    method: 'POST',
    json: { isRead: true },
  });
  check('marking read returns isRead=true', markRead.status === 200 && markRead.body.isRead === true);

  const unreadList = await call('/api/articles?unread=true&limit=100');
  const stillUnread = unreadList.body.articles.some((a) => a.id === firstArticle.id);
  check('read article leaves the unread filter', !stillUnread);

  const toggle = await call(`/api/articles/${firstArticle.id}/read`, { method: 'POST' });
  check('empty body toggles state', toggle.body.isRead === false, `isRead=${toggle.body.isRead}`);

  const missing = await call('/api/articles/99999999/read', { method: 'POST', json: { isRead: true } });
  check('unknown article returns 404', missing.status === 404, `got ${missing.status}`);

  // Put it back to read for later assertions.
  await call(`/api/articles/${firstArticle.id}/read`, { method: 'POST', json: { isRead: true } });
}

// --- full-text search ------------------------------------------------------
console.log('\nfull-text search');
{
  const word = (firstArticle.title ?? '').split(/\s+/).find((w) => w.length > 4) ?? 'the';
  const search = await call(`/api/articles?q=${encodeURIComponent(word)}&limit=10`);
  check('search returns results', search.status === 200 && search.body.articles.length > 0, `q="${word}"`);

  const nonsense = await call('/api/articles?q=zzzzqqqxxyyww');
  check('no-match query returns empty set', nonsense.body.articles.length === 0);

  const malformed = await call('/api/articles?q=%22unclosed+quote&limit=5');
  check('malformed query does not 500', malformed.status === 200, `got ${malformed.status}`);

  const operators = await call('/api/articles?q=news+OR+the&limit=5');
  check('websearch operators are accepted', operators.status === 200);
}

// --- refresh & conditional GET --------------------------------------------
console.log('\nrefresh');
{
  const first = await call('/api/refresh', { method: 'POST', json: {} });
  check('manual refresh succeeds', first.status === 200);
  check('refresh reports per-feed results', Array.isArray(first.body.results));
  check('refresh reports counts', typeof first.body.inserted === 'number');

  const before = (await call('/api/articles?limit=1')).body.total;

  const second = await call('/api/refresh', { method: 'POST', json: {} });
  check('second refresh succeeds', second.status === 200);
  check(
    'second refresh inserts nothing new (dedup holds)',
    second.body.inserted === 0,
    `inserted=${second.body.inserted}`,
  );

  // Conditional GET only produces a 304 when a feed actually advertises an
  // ETag or Last-Modified; several large feeds (BBC) advertise neither, so this
  // is checked against a feed known to send validators rather than asserted
  // across the board.
  const validatorFeed = feeds.find((feed) => /hnrss\.org/.test(feed.url));
  if (validatorFeed) {
    // Refresh once so the validator is stored, then again to replay it.
    await call('/api/refresh', { method: 'POST', json: { feedId: validatorFeed.id } });
    const replay = await call('/api/refresh', { method: 'POST', json: { feedId: validatorFeed.id } });
    const result = replay.body.results?.[0];
    check(
      'conditional GET returns 304 for a feed that sends Last-Modified',
      result?.status === 'unchanged',
      `status=${result?.status}`,
    );
  } else {
    console.log('  SKIP  conditional GET (no validator-capable feed seeded)');
  }

  check(
    'every refresh result has a known status',
    (second.body.results ?? []).every((r) =>
      ['ok', 'unchanged', 'error', 'skipped'].includes(r.status),
    ),
  );

  const after = (await call('/api/articles?limit=1')).body.total;
  check('article count is stable across refreshes', before === after, `${before} -> ${after}`);

  const single = await call('/api/refresh', { method: 'POST', json: { feedId: feeds[0].id } });
  check('single-feed refresh works', single.body.total === 1, `total=${single.body.total}`);
}

// --- mark all read ---------------------------------------------------------
console.log('\nbulk operations');
{
  const target = feeds[0];
  const all = await call('/api/articles/read-all', {
    method: 'POST',
    json: { isRead: true, feedId: target.id },
  });
  check('mark-all-read updates rows', all.status === 200 && all.body.updated > 0, `updated=${all.body.updated}`);

  const unread = await call(`/api/articles?feedId=${target.id}&unread=true`);
  check('feed has no unread left', unread.body.articles.length === 0);

  const back = await call('/api/articles/read-all', {
    method: 'POST',
    json: { isRead: false, feedId: target.id },
  });
  check('mark-all-unread restores rows', back.body.updated > 0, `updated=${back.body.updated}`);
}

// --- sanitization ----------------------------------------------------------
console.log('\nsanitization');
{
  const doc = await call('/api/articles?limit=100&withContent=true');
  const bodies = doc.body.articles.map((a) => a.content ?? '').join('\n');
  check('no <script> in stored content', !/<script/i.test(bodies));
  check('no onerror= handlers', !/onerror\s*=/i.test(bodies));
  check('no javascript: URLs', !/javascript:/i.test(bodies));
}

// --- OPML ------------------------------------------------------------------
console.log('\nOPML');
{
  const exported = await fetch(`${BASE}/api/opml/export`, { headers: { cookie } });
  const xml = await exported.text();
  check('export returns 200', exported.status === 200);
  check('export is OPML', xml.includes('<opml') && xml.includes('xmlUrl='));
  check('export includes feed URLs', feeds.every((f) => xml.includes(f.url)));
  check(
    'export sets a download filename',
    (exported.headers.get('content-disposition') ?? '').includes('attachment'),
  );

  const imported = await call('/api/opml/import', {
    method: 'POST',
    headers: { 'content-type': 'text/xml' },
    body: xml,
  });
  check('importing its own export succeeds', imported.status === 200);
  check(
    're-import is idempotent (all duplicates)',
    imported.body.imported === 0 && imported.body.duplicates === feeds.length,
    `imported=${imported.body.imported} duplicates=${imported.body.duplicates}`,
  );

  const bad = await call('/api/opml/import', {
    method: 'POST',
    headers: { 'content-type': 'text/xml' },
    body: '<not-opml/>',
  });
  check('invalid OPML rejected', bad.status === 422, `got ${bad.status}`);
}

// --- cron auth -------------------------------------------------------------
console.log('\ncron');
{
  const noToken = await fetch(`${BASE}/api/cron/refresh`);
  check('cron without token is 401', noToken.status === 401, `got ${noToken.status}`);

  const wrongToken = await fetch(`${BASE}/api/cron/refresh`, {
    headers: { authorization: 'Bearer wrong-secret' },
  });
  check('cron with wrong token is 401', wrongToken.status === 401, `got ${wrongToken.status}`);

  // Only run the success path when the expected secret is known.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const ok = await fetch(`${BASE}/api/cron/refresh`, {
      headers: { authorization: `Bearer ${cronSecret}` },
    });
    const body = await ok.json();
    check('cron with correct token succeeds', ok.status === 200, `got ${ok.status}`);
    check('cron returns a refresh report', typeof body.total === 'number', `total=${body.total}`);

    const bare = await fetch(`${BASE}/api/cron/refresh`, {
      headers: { authorization: cronSecret },
    });
    check('cron rejects a token without the Bearer prefix', bare.status === 401, `got ${bare.status}`);
  } else {
    console.log('  SKIP  cron success path (set CRON_SECRET to enable)');
  }
}

// --- delete cascade --------------------------------------------------------
console.log('\ndelete cascade');
{
  const cascadeUrl = 'https://www.theverge.com/rss/index.xml';
  const added = await call('/api/feeds', { method: 'POST', json: { url: cascadeUrl } });

  // A 409 means an earlier run already added it. The assertions below still
  // apply, so treat that as usable rather than failing on pre-existing state.
  check(
    'adding a third feed works',
    added.status === 201 || added.status === 409,
    `status=${added.status}`,
  );

  const existing = (await call('/api/feeds')).body.feeds?.find((f) => f.url === cascadeUrl);
  const newId = added.status === 201 ? added.body.feed.id : existing?.id ?? null;

  if (newId !== null) {
    const before = (await call(`/api/articles?feedId=${newId}&limit=100`)).body.total;
    check('new feed has articles', before > 0, `${before} articles`);

    const removed = await call(`/api/feeds/${newId}`, { method: 'DELETE' });
    check('delete returns ok', removed.status === 200 && removed.body.ok === true);

    const after = await call(`/api/articles?feedId=${newId}&limit=100`);
    check('cascade removed the articles', after.body.total === 0, `${after.body.total} remaining`);

    const gone = await call(`/api/feeds/${newId}`, { method: 'DELETE' });
    check('deleting again is 404', gone.status === 404, `got ${gone.status}`);
  } else {
    check('located the cascade test feed', false, 'could not determine its id');
  }
}

// --- folders ---------------------------------------------------------------
console.log('\nfolders');
let folderId = null;
let subfolderId = null;
{
  const created = await call('/api/folders', {
    method: 'POST',
    json: { name: `Tech ${Date.now()}` },
  });
  check('folder can be created', created.status === 201, `got ${created.status}`);
  folderId = created.body?.folder?.id ?? null;

  const duplicate = await call('/api/folders', {
    method: 'POST',
    json: { name: created.body?.folder?.name },
  });
  check('duplicate folder name is rejected', duplicate.status === 409, `got ${duplicate.status}`);

  const nameless = await call('/api/folders', { method: 'POST', json: { name: '  ' } });
  check('empty folder name is rejected', nameless.status === 400, `got ${nameless.status}`);

  if (folderId !== null) {
    const child = await call('/api/folders', {
      method: 'POST',
      json: { name: `News ${Date.now()}`, parentId: folderId },
    });
    check('subfolder can be created', child.status === 201, `got ${child.status}`);
    subfolderId = child.body?.folder?.id ?? null;

    if (subfolderId !== null) {
      const grandchild = await call('/api/folders', {
        method: 'POST',
        json: { name: 'Too deep', parentId: subfolderId },
      });
      check('third level of nesting is rejected', grandchild.status === 400, `got ${grandchild.status}`);
    }
  }

  const tree = await call('/api/folders');
  check('folder list returns a tree', tree.status === 200 && Array.isArray(tree.body.folders));
  const node = (tree.body.folders ?? []).find((f) => f.id === folderId);
  check('created folder appears with children', !!node && node.children.length === 1);
  check(
    'folder reports rolled-up counts',
    node && typeof node.unread === 'number' && typeof node.feedCount === 'number',
  );

  const renamed = await call('/api/folders', {
    method: 'PATCH',
    json: { id: folderId, name: `Renamed ${Date.now()}` },
  });
  check('folder can be renamed', renamed.status === 200, `got ${renamed.status}`);
}

// --- moving feeds into folders --------------------------------------------
console.log('\nfeed folders');
{
  const target = feeds[0];
  const moved = await call(`/api/feeds/${target.id}`, {
    method: 'PATCH',
    json: { folderId },
  });
  check('feed can be moved into a folder', moved.status === 200, `got ${moved.status}`);
  check('feed reports the new folder', moved.body?.feed?.folderId === folderId);

  // Filtering by the folder must return that feed's articles.
  const inFolder = await call(`/api/articles?folderId=${folderId}&limit=100`);
  check('folder filter returns the folder feed articles', inFolder.body.total > 0, `total=${inFolder.body.total}`);
  check(
    'folder filter only returns articles from that folder',
    inFolder.body.articles.every((a) => a.feedId === target.id),
  );

  const folderUnread = await call('/api/feeds');
  const folderNode = (folderUnread.body.folders ?? []).find((f) => f.id === folderId);
  check('folder unread count reflects its feed', folderNode && folderNode.unread > 0, `unread=${folderNode?.unread}`);

  const badFolder = await call(`/api/feeds/${target.id}`, {
    method: 'PATCH',
    json: { folderId: 99999999 },
  });
  check('moving into a missing folder is 404', badFolder.status === 404, `got ${badFolder.status}`);

  const unfiled = await call(`/api/articles?folderId=${folderId}&unread=true&limit=5`);
  check('folder filter combines with unread', unfiled.status === 200);
}

// --- tags ------------------------------------------------------------------
console.log('\ntags');
let tagId = null;
{
  const target = feeds[0];
  const label = `newsletter-${Date.now()}`;

  const assigned = await call(`/api/feeds/${target.id}/tags`, {
    method: 'PUT',
    json: { tags: [label, 'reading-list'] },
  });
  check('tags can be assigned to a feed', assigned.status === 200, `got ${assigned.status}`);
  check('both tags are stored', assigned.body?.tags?.length === 2, `tags=${JSON.stringify(assigned.body?.tags)}`);

  const list = await call('/api/tags');
  check('tag list returns tags', list.status === 200 && Array.isArray(list.body.tags));
  const entry = (list.body.tags ?? []).find((t) => t.name === label);
  check('assigned tag appears in the tag list', !!entry);
  tagId = entry?.id ?? null;
  check('tag reports a feed count', entry && entry.feedCount >= 1, `feedCount=${entry?.feedCount}`);

  if (tagId !== null) {
    const byTag = await call(`/api/articles?tagId=${tagId}&limit=100`);
    check('tag filter returns articles', byTag.body.total > 0, `total=${byTag.body.total}`);
    check(
      'tag filter only returns that feed',
      byTag.body.articles.every((a) => a.feedId === target.id),
    );
  }

  // Whitespace/duplicates should collapse, not create duplicate rows.
  const deduped = await call(`/api/feeds/${target.id}/tags`, {
    method: 'PUT',
    json: { tags: ['  reading-list  ', 'reading-list'] },
  });
  check('duplicate tag names collapse', deduped.body?.tags?.length === 1, `tags=${JSON.stringify(deduped.body?.tags)}`);

  // Clearing removes tags and prunes the now-orphaned tag rows.
  const cleared = await call(`/api/feeds/${target.id}/tags`, { method: 'PUT', json: { tags: [] } });
  check('tags can be cleared', cleared.status === 200 && cleared.body.tags.length === 0);

  const afterClear = await call('/api/tags');
  check(
    'orphaned tags are pruned',
    !(afterClear.body.tags ?? []).some((t) => t.name === label),
  );

  const badShape = await call(`/api/feeds/${target.id}/tags`, {
    method: 'PUT',
    json: { tags: 'not-an-array' },
  });
  check('non-array tags rejected', badShape.status === 400, `got ${badShape.status}`);

  const missingFeed = await call('/api/feeds/99999999/tags', {
    method: 'PUT',
    json: { tags: ['x'] },
  });
  check('tagging a missing feed is 404', missingFeed.status === 404, `got ${missingFeed.status}`);
}

// --- full-text extraction --------------------------------------------------
console.log('\nextraction');
{
  // Extraction reaches out to a third-party news site. Keep it opt-in so the
  // default suite stays fast and does not depend on an external publisher.
  if (process.env.E2E_EXTRACTION !== '1') {
    console.log('  SKIP  (set E2E_EXTRACTION=1 to exercise live extraction)');
  } else {
    const bbc = feeds.find((feed) => /bbci\.co\.uk/.test(feed.url));

    if (!bbc) {
      console.log('  SKIP  no BBC feed available to extract from');
    } else {
      const list = await call(`/api/articles?feedId=${bbc.id}&q=uninsurable&limit=1`);
      const target = list.body?.articles?.[0];

      if (!target) {
        console.log('  SKIP  expected article not present in the feed right now');
      } else {
        // The article may already have been extracted by an earlier run, so the
        // feed's own teaser is the meaningful baseline to compare against.
        const teaserLength = (target.summary ?? '').length;

        const extracted = await call(`/api/articles/${target.id}/extract`, {
          method: 'POST',
          json: { force: true },
        });
        check('extraction request succeeds', extracted.status === 200, `got ${extracted.status}`);

        if (extracted.status === 200) {
          const article = extracted.body.article;
          check('article is marked as extracted', article.isExtracted === true);

          const textLength = (article.content ?? '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim().length;

          check(
            'extracted text is substantially longer than the feed teaser',
            textLength > Math.max(500, teaserLength * 3),
            `teaser ${teaserLength} -> extracted ${textLength} chars`,
          );
          check('no script tags survive extraction', !/<script/i.test(article.content ?? ''));
          check(
            'no inline event handlers survive extraction',
            !/\son\w+\s*=/i.test(article.content ?? ''),
          );
          check('a byline was captured from the source page', Boolean(article.author));

          // A second call must be served from storage, not refetched.
          const started = Date.now();
          const cached = await call(`/api/articles/${target.id}/extract`, {
            method: 'POST',
            json: {},
          });
          const elapsed = Date.now() - started;
          check('repeat extraction is served from cache', elapsed < 1500, `${elapsed}ms`);
          check('cached extraction returns the same body', cached.body.article.isExtracted === true);
        }
      }
    }
  }

  // The SSRF guard is checked directly, since the API never accepts an
  // arbitrary URL to fetch. Imported from the plain-JS module so this script
  // does not need the app's TypeScript resolution.
  const { isBlockedHost } = await import('../lib/urlSafety.mjs');
  check('guard blocks loopback', isBlockedHost('localhost') && isBlockedHost('127.0.0.1'));
  check('guard blocks private ranges', isBlockedHost('10.0.0.1') && isBlockedHost('192.168.1.5'));
  check('guard blocks cloud metadata address', isBlockedHost('169.254.169.254'));
  check('guard allows public hosts', !isBlockedHost('www.bbc.co.uk') && !isBlockedHost('example.com'));
}

// --- reader endpoint -------------------------------------------------------
console.log('\nreader');
{
  const sample = (await call('/api/articles?limit=1')).body.articles?.[0];
  if (sample) {
    const one = await call(`/api/articles/${sample.id}`);
    check('single article endpoint works', one.status === 200, `got ${one.status}`);
    check('single article includes full content field', 'content' in (one.body?.article ?? {}));
    check('single article includes feed title', !!one.body?.article?.feedTitle);

    const missing = await call('/api/articles/99999999');
    check('missing article is 404', missing.status === 404, `got ${missing.status}`);

    const bad = await call('/api/articles/not-a-number');
    check('non-numeric article id is 400', bad.status === 400, `got ${bad.status}`);
  } else {
    console.log('  SKIP  reader (no articles available)');
  }
}

// --- folder deletion semantics --------------------------------------------
console.log('\nfolder deletion');
{
  if (folderId !== null && subfolderId !== null) {
    const target = feeds[0];
    // Put the feed in the SUBFOLDER, then delete the PARENT. The feed must
    // survive and be promoted to the top level, not deleted.
    await call(`/api/feeds/${target.id}`, { method: 'PATCH', json: { folderId: subfolderId } });

    const removed = await call(`/api/folders?id=${folderId}`, { method: 'DELETE' });
    check('folder delete returns ok', removed.status === 200, `got ${removed.status}`);

    const afterFeeds = await call('/api/feeds');
    const survivor = (afterFeeds.body.feeds ?? []).find((f) => f.id === target.id);
    check('feed survives its folder being deleted', !!survivor);
    check(
      'feed is promoted rather than orphaned to a deleted folder',
      survivor?.folderId === null,
      `folderId=${survivor?.folderId}`,
    );

    const stillThere = await call(`/api/articles?feedId=${target.id}&limit=1`);
    check('articles survive folder deletion', stillThere.body.total > 0, `total=${stillThere.body.total}`);

    const subGone = (afterFeeds.body.folders ?? []).find((f) => f.id === subfolderId);
    const childGone = (afterFeeds.body.folders ?? []).some((f) =>
      f.children.some((c) => c.id === subfolderId),
    );
    check('subfolder is removed with its parent', !subGone && !childGone);

    const again = await call(`/api/folders?id=${folderId}`, { method: 'DELETE' });
    check('deleting a missing folder is 404', again.status === 404, `got ${again.status}`);
  } else {
    console.log('  SKIP  folder deletion (setup incomplete)');
  }
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
