import { envOr } from '@broker/utils';
/**
 * Единая конфигурация сайта: публичный адрес.
 *
 * Имени и описания сайта здесь больше нет (прежде `SITE_NAME`,
 * `SITE_DESCRIPTION`): бренд — данные CMS (`lib/brand.ts`), описание —
 * SEO-текст `messages.meta.description` до переноса в CMS v2.
 */

// Пустая строка — не отсутствие (WEB-21). Отсюда растут канонические
// адреса, sitemap, OG и JSON-LD: пустой адрес ломает их молча.
export const SITE_URL = envOr(process.env.NEXT_PUBLIC_SITE_URL, 'https://example-broker.com');
