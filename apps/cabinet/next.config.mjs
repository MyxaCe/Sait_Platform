import { withSentryConfig } from '@sentry/nextjs';
import createNextIntlPlugin from 'next-intl/plugin';

import { SERVER_ACTION_BODY_LIMIT_BYTES } from './upload-limits.mjs';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ['@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'],
    serverActions: { bodySizeLimit: SERVER_ACTION_BODY_LIMIT_BYTES },
  },
  output: process.env.BUILD_STANDALONE ? 'standalone' : undefined,
  transpilePackages: [
    '@broker/live-params',
    '@broker/promo',
    '@broker/ui',
    '@broker/utils',
    '@broker/realtime',
    '@broker/api-client',
    '@broker/tenant',
    '@broker/storage',
    '@broker/money',
    '@broker/support',
    '@broker/transfer',
  ],
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      ],
    },
  ],
};

export default withSentryConfig(withNextIntl(nextConfig), {
  silent: true,
  disableLogger: true,
  sourcemaps: { disable: true },
  telemetry: false,
});

