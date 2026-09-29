import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  createSessionToken,
  getAuthConfig,
  sessionCookieOptions,
  sessionTtlSeconds,
  timingSafeEqual,
} from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Best-effort throttle. Each serverless instance has its own map, so this
 * blunts online guessing without pretending to be a real rate limiter.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function tooManyAttempts(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

export async function POST(request: Request) {
  const { password: expected, secret } = getAuthConfig();

  // 503 rather than 200: nothing was authenticated and nothing was issued.
  if (!secret || !expected) {
    return NextResponse.json(
      { error: 'APP_PASSWORD is not configured on the server.' },
      { status: 503 },
    );
  }

  // Basic CSRF hygiene: browsers always send Origin on cross-site POSTs.
  const origin = request.headers.get('origin');
  if (origin) {
    const host = request.headers.get('host');
    try {
      if (host && new URL(origin).host !== host) {
        return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
    }
  }

  const forwardedFor = request.headers.get('x-forwarded-for');
  const clientKey = forwardedFor?.split(',')[0]?.trim() || 'unknown';

  if (tooManyAttempts(clientKey)) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      { status: 429 },
    );
  }

  let submitted = '';
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as { password?: unknown };
      submitted = typeof body.password === 'string' ? body.password : '';
    } else {
      const form = await request.formData();
      const value = form.get('password');
      submitted = typeof value === 'string' ? value : '';
    }
  } catch {
    return NextResponse.json({ error: 'Malformed request body' }, { status: 400 });
  }

  if (!submitted || !timingSafeEqual(submitted, expected)) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  }

  attempts.delete(clientKey);

  const { token } = await createSessionToken(secret);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(sessionTtlSeconds()));
  return response;
}
