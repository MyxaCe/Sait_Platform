import { envOr } from '@broker/utils';
/** Единая конфигурация сайта: URL и название берутся отсюда во всех SEO-файлах. */

// Пустая строка — не отсутствие (WEB-21). Отсюда растут канонические
// адреса, sitemap, OG и JSON-LD: пустой адрес ломает их молча.
export const SITE_URL = envOr(process.env.NEXT_PUBLIC_SITE_URL, 'https://example-broker.com');

export const SITE_NAME = 'Apex Capital';

export const SITE_DESCRIPTION =
  '12 000+ торговых инструментов: Forex, акции, криптовалюты, индексы и металлы. Спреды от 0.0 пунктов, исполнение за 14 мс.';
