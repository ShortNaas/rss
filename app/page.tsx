import { ReaderApp } from '@/components/ReaderApp';
import { isNeon } from '@/lib/db';

// The article list is per-user mutable state, never static.
export const dynamic = 'force-dynamic';

export default function Page() {
  // Surfaced as a banner so it is obvious when data is living in the local
  // PGlite directory rather than in Postgres.
  return <ReaderApp localDatabase={!isNeon} />;
}
