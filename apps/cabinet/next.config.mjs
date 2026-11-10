import { withSentryConfig } from '@sentry/nextjs';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // instrumentation.ts (серверный Sentry) в Next 14.2 — за флагом.
  // @aws-sdk/* — чистый JS (Р-453 про нативные модули его не касается), но
  // крупный: держим его в node_modules серверной сборки, а не в бандле —
  // @broker/storage транспилируется, требование к aws-sdk остаётся внешним.
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ['@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner'],
  },
  // standalone — только для Docker-сборки (docker/cabinet.Dockerfile)
  output: process.env.BUILD_STANDALONE ? 'standalone' : undefined,
  transpilePackages: [
    '@broker/ui',
    '@broker/utils',
    '@broker/realtime',
    '@broker/api-client',
    '@broker/tenant',
    '@broker/storage',
    '@broker/money',
    '@broker/support',
  ],
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        // Кабинет никому нельзя встраивать в iframe и индексировать
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

