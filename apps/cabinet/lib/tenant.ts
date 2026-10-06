/**
 * Конфиг тенанта из CMS (карточка сайта, `GET {CMS_API_URL}/cms/sites/{slug}`,
 * под серверным ключом): стартовый демо-баланс и allow-list инструментов.
 * Единый источник для регистрации (стартовый баланс), модуля «Рынки»
 * (allow-list) и сброса демо-счёта.
 *
 * **Решение живёт в `@broker/tenant`, не здесь** (Р-029, PKG-04). Этот
 * файл — только адаптер: окружение кабинета плюс его параметры
 * кеширования. Дословная копия границы доступа, лежавшая здесь и в
 * витрине, убрана: расхождение именно этих двух реализаций на одних и тех
 * же данных и было дефектом Р-025.
 *
 * Два поля ответа — две РАЗНЫЕ политики, и путать их нельзя:
 *
 *  - **allow-list** — граница доступа, fail-closed (`access.ts` пакета);
 *  - **стартовый баланс** — сумма, и при `null` кабинет ОТКАЗЫВАЕТ, а не
 *    подставляет своё число (Р-040, `balance.ts` пакета). Прежний фолбэк
 *    «$10 000, параметр удобства ничего не разрешает» отменён штабом:
 *    открыть демо-счёт на сумму, которую никто не назначал, хуже, чем не
 *    открыть.
 */

import {
  EDITORIAL_REUSE_WINDOW_SECONDS,
  fetchTenantConfig,
  isSymbolAllowed,
  type TenantConfig,
  type TenantStartBalance,
} from '@broker/tenant';

export { isSymbolAllowed };
export type {
  TenantAccess,
  TenantAccessUnavailableReason,
  TenantConfig,
  TenantStartBalance,
  TenantStartBalanceUnavailableReason,
} from '@broker/tenant';

export async function getTenantConfig(): Promise<TenantConfig> {
  return fetchTenantConfig({
    baseUrl: process.env.CMS_API_URL,
    slug: process.env.SITE_SLUG ?? 'apex-ru',
    apiKey: process.env.CMS_API_KEY || undefined,
    fetchInit: { next: { revalidate: EDITORIAL_REUSE_WINDOW_SECONDS } } as RequestInit,
  });
}

/**
 * Стартовый демо-баланс тенанта — РЕШЕНИЕ, а не число.
 *
 * Возвращает состояние, а не `number`: сигнатура `Promise<number>` не
 * оставляла вызывающему возможности отказать — ему пришлось бы получить
 * какое-то число, а единственное число, которое мы могли бы придумать, и
 * есть запрещённое умолчание.
 */
export async function getTenantStartBalance(): Promise<TenantStartBalance> {
  return (await getTenantConfig()).startBalance;
}
