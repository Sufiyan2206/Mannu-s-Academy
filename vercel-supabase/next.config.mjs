import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // runs as a normal Node server (npm start); these packages are loaded from node_modules at run time
  serverExternalPackages: ['@ffmpeg-installer/ffmpeg', 'pg', 'bcryptjs'],
  webpack(config) {
    // `npm run dev:mock` swaps the database connection for an in-memory demo so the screens can be tried with no setup.
    if (process.env.MOCK_DB === '1') config.resolve.alias['@/lib/client'] = path.join(here, 'tests/mock/client.ts');
    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), display-capture=(self), geolocation=()' },
        ],
      },
    ];
  },
};
export default nextConfig;
