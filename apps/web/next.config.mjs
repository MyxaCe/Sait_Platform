import { withSentryConfig } from '@sentry/nextjs';
import withSerwistInit from '@serwist/next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
});

const frameAncestorsRaw = (process.env.FRAME_ANCESTORS ?? '').trim();
const frameAncestors = frameAncestorsRaw.length > 0 ? frameAncestorsRaw : "'none'";

const BUILD_SCOPED_ENV = [
  'NEXT_PUBLIC_CABINET_URL',
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_SENTRY_DSN',
  'NEXT_PUBLIC_WS_URL',
  'FRAME_ANCESTORS',
  'BUILD_STANDALONE',
];

const buildFingerprint = JSON.stringify(
  Object.fromEntries(
    BUILD_SCOPED_ENV.map((name) => [
      name,
      typeof process.env[name] === 'string' && process.env[name].length > 0,
    ]),
  ),
);

const nextConfig = {
  reactStrictMode: true,
  env: { BUILD_CONFIG_FINGERPRINT: buildFingerprint },
  experimental: { instrumentationHook: true },
  output: process.env.BUILD_STANDALONE ? 'standalone' : undefined,
  transpilePackages: [
    '@broker/promo',
    '@broker/money',
    '@broker/ui',
    '@broker/utils',
    '@broker/realtime',
    '@broker/api-client',
    '@broker/tenant',
    '@broker/money',
    '@broker/support',
  ],
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [320, 428, 768, 1024, 1440, 1920, 2560],
  },
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        { key: 'Content-Security-Policy', value: `frame-ancestors ${frameAncestors}` },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    },
    {
      source: '/sw.js',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
    },
  ],
};

export default withSentryConfig(withNextIntl(withSerwist(nextConfig)), {
  silent: true,
  disableLogger: true,
  sourcemaps: { disable: true },
  telemetry: false,
});
