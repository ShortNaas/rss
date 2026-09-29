/**
 * Single-user password gate.
 *
 * There is no user table: a session is an HMAC-signed, expiring cookie value.
 * Changing APP_PASSWORD (or SESSION_SECRET) invalidates every existing session,
 * which is the intended way to revoke access.
 *
 * Web Crypto is used rather than node:crypto so this module also works from
 * middleware under the edge runtime.
 */

export const SESSION_COOKIE = 'rss_session';
export const SESSION_TTL_DAYS = 30;
const SESSION_TTL_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60;

const encoder = new TextEncoder();

export interface AuthConfig {
  password: string;
  /** Null when auth is disabled (no APP_PASSWORD set). */
  secret: string | null;
}

/**
 * Returns the active auth config, or a disabled config when no password is
 * configured. Callers must treat `secret === null` as "auth off".
 */
export function getAuthConfig(): AuthConfig {
  const password = process.env.APP_PASSWORD ?? '';
  if (!password) return { password: '', secret: null };

  return { password, secret: process.env.SESSION_SECRET || password };
}

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return base64UrlEncode(signature);
}

/**
 * Constant-time comparison.
 *
 * Iterates over the LONGER of the two inputs and pads the shorter one with
 * zeros. Iterating over the shorter length (e.g. via `left[i] ?? 0` when the
 * comparison runs to `max`) would silently stop comparing at the shorter
 * string's end and let an attacker append arbitrary bytes to a truncated
 * signature.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const length = Math.max(left.length, right.length);

  let mismatch = left.length ^ right.length;
  for (let i = 0; i < length; i++) {
    // Read explicitly with a bounds check so out-of-range access can never
    // produce NaN (which would poison the accumulator into 0).
    const l = i < left.length ? left[i] : 0;
    const r = i < right.length ? right[i] : 0;
    mismatch |= l ^ r;
  }
  return mismatch === 0;
}

/** Creates `expiry.signature` for the given secret. */
export async function createSessionToken(secret: string, ttlSeconds = SESSION_TTL_SECONDS) {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const signature = await sign(secret, String(expiresAt));
  return { token: `${expiresAt}.${signature}`, expiresAt };
}

export async function verifySessionToken(secret: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;

  const separator = token.lastIndexOf('.');
  if (separator <= 0) return false;

  const expiresRaw = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

  const expected = await sign(secret, expiresRaw);
  return timingSafeEqual(expected, signature);
}

export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}

export function sessionTtlSeconds() {
  return SESSION_TTL_SECONDS;
}
