import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // PGlite ships WebAssembly + a bundled Postgres binary; keep it external so
  // Next does not try to bundle it into the server output.
  serverExternalPackages: ['@electric-sql/pglite'],
  poweredByHeader: false,
  turbopack: {
    // A lockfile exists in a parent directory; pin the root so Turbopack does
    // not treat that whole tree as the project.
    root: import.meta.dirname,
  },
};

export default nextConfig;
