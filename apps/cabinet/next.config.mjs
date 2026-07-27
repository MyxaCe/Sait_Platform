import { withSentryConfig } from '@sentry/nextjs';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // instrumentation.ts (серверный Sentry) в Next 14.2 — за флагом
  experimental: { instrumentationHook: true },
  // standalone — только для Docker-сборки (docker/cabinet.Dockerfile)
  output: process.env.BUILD_STANDALONE ? 'standalone' : undefined,
  transpilePackages: ['@broker/ui', '@broker/utils', '@broker/realtime', '@broker/api-client'],
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

