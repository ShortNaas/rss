/**
 * URL safety checks for full-text extraction.
 *
 * Plain JavaScript on purpose: this module is imported by both the Next.js app
 * and `scripts/e2e.mjs` under plain Node, where the app's extensionless
 * TypeScript imports cannot be resolved.
 */

/** Hostname patterns that must never be fetched: loopback, private, link-local. */
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, // link-local, including cloud metadata at 169.254.169.254
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i, // unique local IPv6
  /^\[?fe80:/i, // link-local IPv6
  /^\[?::ffff:(127\.|10\.|192\.168\.|169\.254\.)/i, // IPv4-mapped IPv6
  /\.local$/i,
  /\.internal$/i,
];

/**
 * Blocks obviously-internal destinations.
 *
 * Defence in depth for a single-user app, not a complete SSRF solution: a
 * public hostname that resolves to a private address is not caught here,
 * because doing DNS resolution on every extraction invites rebinding problems
 * of its own. Do not expose the extract endpoint to untrusted users.
 *
 * @param {string} hostname
 * @returns {boolean}
 */
export function isBlockedHost(hostname) {
  const host = String(hostname ?? '').trim().toLowerCase();
  if (!host) return true;
  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

/**
 * Validates a URL for fetching, returning a parsed URL.
 * @param {string} rawUrl
 * @returns {URL}
 */
export function assertFetchableUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Article link is not a valid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https article links can be read');
  }
  if (isBlockedHost(url.hostname)) {
    throw new Error('Refusing to fetch an internal address');
  }

  return url;
}
