/**
 * Tests the transient-failure retry behaviour in lib/http.ts.
 *
 * Uses a throwaway local HTTP server so nothing depends on the internet and the
 * exact number of requests can be asserted.
 *
 * Run with: npm run test:http   (tsx is required to load the TypeScript module)
 */
import { createServer } from 'node:http';
import { fetchFeedDocument, looksLikeFeed, normalizeFeedUrl } from '../lib/http.ts';

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

/**
 * Starts a server whose behaviour is driven by a queue of statuses.
 * The last entry repeats. Returns the base URL and a request counter.
 */
async function startServer(script) {
  let requests = 0;
  const server = createServer((req, res) => {
    const index = Math.min(requests, script.length - 1);
    const step = script[index];
    requests += 1;

    if (step === 'reset') {
      req.socket.destroy();
      return;
    }
    res.writeHead(step, { 'content-type': 'application/rss+xml' });
    res.end('<?xml version="1.0"?><rss version="2.0"><channel><title>T</title></channel></rss>');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/feed`,
    get requests() {
      return requests;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

console.log('\nHTTP fetch retry behaviour\n');

// --- default: no retries ---------------------------------------------------
console.log('default (single attempt)');
{
  const server = await startServer([503]);
  const result = await fetchFeedDocument(server.url);
  check('503 returns an error by default', result.status === 'error', result.error);
  check('503 was requested exactly once', server.requests === 1, `${server.requests} request(s)`);
  await server.close();

  const notFound = await startServer([404]);
  const missing = await fetchFeedDocument(notFound.url);
  check('404 returns an error', missing.status === 'error');
  check('404 is not retried', notFound.requests === 1, `${notFound.requests} request(s)`);
  await server.close();
}

// --- retries enabled: recovery ---------------------------------------------
console.log('\nretries enabled');
{
  const server = await startServer([503, 502, 200]);
  const result = await fetchFeedDocument(server.url, { retryAttempts: 3, retryDelayMs: 10 });
  check('recovers when a later attempt succeeds', result.status === 'ok', `status=${result.status}`);
  check('took exactly three attempts', server.requests === 3, `${server.requests} request(s)`);
  await server.close();
}

{
  const server = await startServer([429, 200]);
  const result = await fetchFeedDocument(server.url, { retryAttempts: 3, retryDelayMs: 10 });
  check('retries 429 (rate limit)', result.status === 'ok');
  check('took two attempts', server.requests === 2, `${server.requests} request(s)`);
  await server.close();
}

{
  // Dropped connections must also be retried.
  const server = await startServer(['reset', 200]);
  const result = await fetchFeedDocument(server.url, { retryAttempts: 3, retryDelayMs: 10 });
  check('retries a dropped connection', result.status === 'ok', `status=${result.status}`);
  await server.close();
}

{
  const server = await startServer([404, 200]);
  const result = await fetchFeedDocument(server.url, { retryAttempts: 3, retryDelayMs: 10 });
  check('404 still fails even with retries enabled', result.status === 'error');
  check('404 was not retried', server.requests === 1, `${server.requests} request(s)`);
  await server.close();
}

{
  // Persistent failure must exhaust attempts and report the last error.
  const server = await startServer([500]);
  const result = await fetchFeedDocument(server.url, { retryAttempts: 3, retryDelayMs: 10 });
  check('gives up after the attempt budget', result.status === 'error', result.error);
  check('used exactly the attempt budget', server.requests === 3, `${server.requests} request(s)`);
  await server.close();
}

// --- helpers ---------------------------------------------------------------
console.log('\nhelpers');
{
  check('detects RSS', looksLikeFeed('<rss version="2.0"><channel/></rss>'));
  check('detects Atom', looksLikeFeed('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"/>'));
  check('detects RDF', looksLikeFeed('<rdf:RDF xmlns:rdf="x"/>'));
  check('detects JSON Feed', looksLikeFeed('{"version":"https://jsonfeed.org/version/1.1"}'));
  check('rejects an HTML page', !looksLikeFeed('<!doctype html><html><body>hi</body></html>'));

  check('adds https to a bare domain', normalizeFeedUrl('example.com/feed') === 'https://example.com/feed');
  check('keeps an explicit scheme', normalizeFeedUrl('http://example.com/feed') === 'http://example.com/feed');
  check(
    'rejects a non-http scheme',
    (() => {
      try {
        normalizeFeedUrl('ftp://example.com/feed');
        return false;
      } catch {
        return true;
      }
    })(),
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
