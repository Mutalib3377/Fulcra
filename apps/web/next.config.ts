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
};

export default nextConfig;
