import withSerwistInit from '@serwist/next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  // В dev-режиме SW отключён: не мешает HMR и не кеширует устаревший код
  disable: process.env.NODE_ENV === 'development',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
        { key: 'X-Frame-Options', value: 'DENY' },
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

export default withNextIntl(withSerwist(nextConfig));
