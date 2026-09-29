import { NextResponse } from 'next/server';
import { refreshFeeds } from '@/lib/refresh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Called by Vercel Cron (see vercel.json). Authenticated with the CRON_SECRET
 * bearer token that Vercel adds automatically rather than a session cookie —
 * middleware explicitly exempts /api/cron/*.
 */
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;

  // Fail closed: without a configured secret this endpoint is not usable.
  if (!secret) return false;

  const header = request.headers.get('authorization');
  if (!header) return false;

  // Constant-time-ish comparison to avoid leaking the secret by timing.
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const report = await refreshFeeds();
  return NextResponse.json(report);
}
