import path from 'node:path';
import type { NextConfig } from 'next';

// All apps share one .env at the repo root. Real environment variables (Render) win.
const rootEnvFile = path.join(import.meta.dirname, '../../.env');
try {
  process.loadEnvFile(rootEnvFile);
} catch {
  // No .env file (CI, Docker, production): use the real environment.
}

const nextConfig: NextConfig = {
  // Self-contained server output for the Docker image.
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: [
    '@fulcra/channels',
    '@fulcra/config',
    '@fulcra/core',
    '@fulcra/db',
    '@fulcra/integrations',
    '@fulcra/ui',
  ],
  // Dev only: let app.localhost and <store>.localhost load dev scripts and hot reload.
  allowedDevOrigins: ['*.localhost'],
  poweredByHeader: false,
  reactStrictMode: true,
  // The website chat script (built by @fulcra/widget into public/): cached briefly so
  // updates reach sellers' sites within minutes.
  async headers() {
    return [
      {
        source: '/widget.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=600, stale-while-revalidate=86400' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
    ];
  },
};

export default nextConfig;
