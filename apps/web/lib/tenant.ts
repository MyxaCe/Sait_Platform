/**
 * Доступ витрины к инструментам — allow-list с карточки сайта в CMS
 * (конфиг тенанта `GET {CMS_API_URL}/cms/sites/{slug}`).
 *
 * **Решение живёт в `@broker/tenant`, не здесь** (Р-029, PKG-04). Этот
 * файл — только адаптер: читает окружение витрины и задаёт её параметры
 * кеширования. Раньше тут лежала дословная копия решения, вторая копия —
 * в кабинете, и держать их в соответствии должны были парные тесты. Тип
 * убрал расхождение, возможность расхождения кода осталась — а Р-025
 * именно про неё.
 *
 * Что это за граница и почему она fail-closed — в шапке
 * `packages/tenant/src/access.ts`; срок годности списка — там же в
 * `expiry.ts` (Р-030).
 */

import {
  accessNotice,
  EDITORIAL_REUSE_WINDOW_SECONDS,
  fetchTenantConfig,
  isAccessClosed,
  isSymbolAllowed,
  type TenantAccess,
} from '@broker/tenant';

export { accessNotice, isAccessClosed, isSymbolAllowed };
export type {
  AccessNoticeSpec,
  TenantAccess,
  TenantAccessUnavailableReason,
} from '@broker/tenant';

export async function getTenantAccess(): Promise<TenantAccess> {
  const slug = process.env.SITE_SLUG ?? 'apex-ru';
  const { access } = await fetchTenantConfig({
    baseUrl: process.env.CMS_API_URL,
    slug,
    apiKey: process.env.CMS_API_KEY || undefined,
    /**
     * Редакционное окно витрины (ADR-009) плюс инвалидация вебхуком
     * карточки сайта. Это НЕ срок годности списка: срок приходит от
     * источника, и когда он короче окна, границу закрывает он
     * (`applyListExpiry` внутри пакета), а не эта цифра.
     */
    fetchInit: {
      next: {
        revalidate: EDITORIAL_REUSE_WINDOW_SECONDS,
        tags: ['cms:brand', `cms:brand:${slug}`],
      },
    } as RequestInit,
  });
  return access;
}
