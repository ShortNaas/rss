import { NextResponse } from 'next/server';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  // maxAge 0 expires the cookie immediately.
  response.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(0));
  return response;
}
