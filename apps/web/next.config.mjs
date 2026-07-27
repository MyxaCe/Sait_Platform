import { withSentryConfig } from '@sentry/nextjs';
import withSerwistInit from '@serwist/next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  // В dev-режиме SW отключён: не мешает HMR и не кеширует устаревший код
  disable: process.env.NODE_ENV === 'development',
});

// Кому разрешено встраивать сайт в iframe: только админке CMS —
// вкладка Preview в Payload рендерит сайт через iframe (замена X-Frame-Options:
// DENY, который блокировал её). Значение фиксируется на СБОРКЕ (headers()
// статичны): для Docker пробрасывается build-arg'ом FRAME_ANCESTORS.
const frameAncestors = process.env.FRAME_ANCESTORS ?? "'self' http://localhost:3001";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // instrumentation.ts (инициализация серверного Sentry) в Next 14.2 — за флагом
  experimental: { instrumentationHook: true },
  // standalone — только для Docker-сборки (docker/web.Dockerfile);
  // локальный `next start` работает в обычном режиме
  output: process.env.BUILD_STANDALONE ? 'standalone' : undefined,
  transpilePackages: ['@broker/ui', '@broker/utils', '@broker/realtime', '@broker/api-client'],
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [320, 428, 768, 1024, 1440, 1920, 2560],
  },
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        // frame-ancestors — современная замена X-Frame-Options: тот же анти-clickjacking,
        // но с allowlist. При наличии CSP-директивы браузеры игнорируют XFO.
        { key: 'Content-Security-Policy', value: `frame-ancestors ${frameAncestors}` },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    },
    {
      // SW всегда должен перепроверяться, иначе обновления зависнут
      source: '/sw.js',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
    },
  ],
};

// Sentry/GlitchTip: оборачиваем последним. Без authToken source maps не
// заливаются (GlitchTip их не принимает так же, как Sentry) — только рантайм.
export default withSentryConfig(withNextIntl(withSerwist(nextConfig)), {
  silent: true,
  disableLogger: true,
  sourcemaps: { disable: true },
  // Отключаем телеметрию Sentry-плагина сборки
  telemetry: false,
});

