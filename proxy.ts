import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, getAuthConfig, verifySessionToken } from './lib/auth';

/**
 * Reachable without a session.
 *
 * The web manifest and the service worker must be public or the browser cannot
 * fetch them: a 307 to /login silently breaks installability and service worker
 * registration. Neither leaks anything — the manifest is app metadata the
 * browser fetches before any session exists, and sw.js is only a caching policy
 * whose cached content is the data-free app shell. All actual feed data stays
 * behind the gate via /api/*, which the service worker never caches.
 */
const PUBLIC_PATHS = new Set([
  '/login',
  '/manifest.webmanifest',
  '/sw.js',
  '/api/auth/login',
  '/api/auth/logout',
]);

function isCronRequest(pathname: string) {
  // Vercel Cron cannot send a session cookie; /api/cron/* authenticates with
  // the CRON_SECRET bearer token inside the route handler instead.
  return pathname === '/api/cron' || pathname.startsWith('/api/cron/');
}

/** Baseline security headers applied to every response that leaves here. */
function withSecurityHeaders<T extends NextResponse>(response: T): T {
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  response.headers.set('x-frame-options', 'DENY');
  response.headers.set('permissions-policy', 'geolocation=(), microphone=(), camera=()');
  return response;
}

/**
 * Single-user auth gate.
 *
 * Next.js 16 renamed the `middleware` file convention to `proxy`, so this file
 * exports `proxy` rather than `middleware`.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { secret } = getAuthConfig();

  // No APP_PASSWORD configured: leave the app open (matches "single user, no
  // auth" from the spec) but never silently pretend it is protected.
  if (!secret) return withSecurityHeaders(NextResponse.next());

  if (PUBLIC_PATHS.has(pathname) || isCronRequest(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(secret, token)) {
    return withSecurityHeaders(NextResponse.next());
  }

  if (pathname.startsWith('/api/')) {
    return withSecurityHeaders(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    );
  }

  const loginUrl = new URL('/login', request.url);
  if (pathname !== '/') loginUrl.searchParams.set('next', pathname);
  return withSecurityHeaders(NextResponse.redirect(loginUrl));
}

export const config = {
  // Skip Next internals and static assets; everything else goes through auth.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
