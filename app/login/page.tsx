import { Suspense } from 'react';
import { LoginForm } from '@/components/LoginForm';

// Reads search params on the client, so it must not be prerendered.
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Suspense
        fallback={
          <div className="w-full max-w-sm rounded-xl border app-border app-panel p-6 text-sm app-text-muted dark:app-border dark:app-muted dark:app-text-muted">
            Loading…
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}
