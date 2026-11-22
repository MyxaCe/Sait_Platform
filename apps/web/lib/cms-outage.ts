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
