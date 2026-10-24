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
/*
 * Список тех, кому разрешено встраивать витрину (WEB-23, Р-224).
 *
 * **Умолчание — «никому», и это не строгость ради строгости.** У
 * обычного адреса промах даёт нерабочую ссылку; здесь промах даёт
 * РАЗРЕШЕНИЕ ВСТРАИВАТЬ. Поэтому не задан — не разрешено никому.
 *
 * **Пустая строка считается отсутствием** (WEB-21): `??` пропустил бы
 * её, и `frame-ancestors ` без значения сделал бы заголовок
 * недействительным — то есть снял бы защиту целиком.
 *
 * В образе сюда попадает плейсхолдер, а настоящее значение подставляет
 * `docker/runtime-config.sh` при запуске. Плейсхолдер выбран так, что
 * промах подстановки тоже никого не пускает: домен `.invalid` не
 * разрешается никогда.
 *
 * Локально список пуст, и вкладка предпросмотра CMS не откроется, пока
 * `FRAME_ANCESTORS` не задан явно. Это цена fail-closed, и она названа.
 */
const frameAncestorsRaw = (process.env.FRAME_ANCESTORS ?? '').trim();
const frameAncestors = frameAncestorsRaw.length > 0 ? frameAncestorsRaw : "'none'";

/**
 * Переменные, действующие ПО ПРИРОДЕ СБОРКИ (WEB-09, B-030).
 *
 * `NEXT_PUBLIC_*` компилятор впекает в браузерный бандл, `FRAME_ANCESTORS`
 * уезжает в статический заголовок, `BUILD_STANDALONE` выбирает форму
 * вывода. В готовом образе `process.env` их уже не содержит — и отпечаток
 * в `/api/health`, который читает окружение рантайма, говорил про них
 * «не задано» о значениях, которые ДЕЙСТВУЮТ. Поле, способное соврать,
 * хуже отсутствующего.
 *
 * Отсюда снимок: `env` инлайнится компилятором на сборке в оба бандла,
 * поэтому ручка здоровья получает факт сборки как факт сборки, а не
 * пытается узнать его из рантайма, где его нет.
 *
 * **Да, это значение замерзает в образе — и здесь это правильно.** Правило
 * «вычисленное на сборке замерзает» запрещает замораживать то, что
 * описывает РАНТАЙМ (момент старта процесса, B-010). Здесь описывается
 * сама сборка, и замороженный снимок — единственная честная форма.
 *
 * Отпечаток булев: ручка не место утечки, а имена уже в `.env.example`.
 */
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

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Снимок сборочных переменных для отпечатка в /api/health (WEB-09).
  // Инлайнится на сборке — именно поэтому и отвечает на вопрос «что было
  // задано, когда собирали», а не «что лежит в окружении сейчас».
  env: { BUILD_CONFIG_FINGERPRINT: buildFingerprint },
  // instrumentation.ts (инициализация серверного Sentry) в Next 14.2 — за флагом
  experimental: { instrumentationHook: true },
  // standalone — только для Docker-сборки (docker/web.Dockerfile);
  // локальный `next start` работает в обычном режиме
  output: process.env.BUILD_STANDALONE ? 'standalone' : undefined,
  transpilePackages: [
    '@broker/ui',
    '@broker/utils',
    '@broker/realtime',
    '@broker/api-client',
    '@broker/tenant',
  ],
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

