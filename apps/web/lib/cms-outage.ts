/**
 * Сигнал «CMS недоступна, и показать нечего» — от рендера к HTTP-слою.
 *
 * App Router не умеет отдать из страницы код 503: брошенная ошибка даёт
 * 500. Поэтому сервер витрины запускается через `server-entry.cjs`: он
 * кладёт на каждый запрос хранилище `AsyncLocalStorage` под глобальным
 * символом, `getCms` отмечает в нём отказ, а обёртка переписывает ответ
 * 500 → 503 + `Retry-After` + `X-Robots-Tag: noindex`.
 *
 * Без обёртки (`next dev`, `next start`) сигнал никуда не уходит, и
 * ответ остаётся 500 с той же страницей «Контент временно недоступен».
 */

export const CMS_OUTAGE_SYMBOL = Symbol.for('broker.web.cmsOutage');

export interface CmsOutageStore {
  outage?: { resource: string };
}

interface StoreHolder {
  getStore(): CmsOutageStore | undefined;
}

export function markCmsOutage(resource: string): void {
  const holder = (globalThis as Record<symbol, StoreHolder | undefined>)[CMS_OUTAGE_SYMBOL];
  const store = holder?.getStore();
  if (store && !store.outage) store.outage = { resource };
}
