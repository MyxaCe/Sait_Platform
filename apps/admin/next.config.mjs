/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // standalone — только для Docker-сборки (docker/admin.Dockerfile, пакет C).
  // По образцу cabinet: образ не знает адресов, сервер стартует из server.js.
  output: process.env.BUILD_STANDALONE ? 'standalone' : undefined,
  transpilePackages: ['@broker/money', '@broker/promo', '@broker/storage', '@broker/support', '@broker/transfer', '@broker/ui', '@broker/utils'],
  // @node-rs/argon2 — нативный аддон (.node). Его НЕЛЬЗЯ бандлить webpack'ом:
  // `next build` падает «Module parse failed» на бинаре. Выносим в external
  // серверной сборки — требуется из node_modules в рантайме (standalone-трейс
  // его включает). Кабинет этой проблемы не знал: там bcryptjs — чистый JS.
  //
  // @aws-sdk/* — чистый JS (Р-453 про нативные модули его не касается), но
  // крупный: держим его в node_modules серверной сборки, а не в бандле, —
  // @broker/storage транспилируется, а требование к aws-sdk остаётся внешним.
  experimental: {
    // instrumentation.ts (такт канала переводов между платформами) — в Next 14.2 за флагом.
    instrumentationHook: true,
    serverComponentsExternalPackages: [
      '@node-rs/argon2',
      '@aws-sdk/client-s3',
      '@aws-sdk/s3-request-presigner',
    ],
  },
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        // Поверхность управления (Р-395): никому нельзя встраивать в iframe
        // и индексировать. Та же защита хрома, что у кабинета, но строже по
        // смыслу — это операторский периметр.
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      ],
    },
  ],
};

export default nextConfig;
