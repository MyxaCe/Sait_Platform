const nextConfig = {
  reactStrictMode: true,
  output: process.env.BUILD_STANDALONE ? 'standalone' : undefined,
  transpilePackages: ['@broker/money', '@broker/promo', '@broker/storage', '@broker/support', '@broker/transfer', '@broker/ui', '@broker/utils'],
  experimental: {
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
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      ],
    },
  ],
};

export default nextConfig;
