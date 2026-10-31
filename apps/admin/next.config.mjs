/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // standalone — только для Docker-сборки (docker/admin.Dockerfile, пакет C).
  // По образцу cabinet: образ не знает адресов, сервер стартует из server.js.
  output: process.env.BUILD_STANDALONE ? 'standalone' : undefined,
  transpilePackages: ['@broker/ui', '@broker/utils'],
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
