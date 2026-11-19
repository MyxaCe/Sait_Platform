import { getTranslations } from 'next-intl/server';
import { createCachedLoader, resolveLiveContent, type LiveLabels, type LiveSnapshot } from '@broker/live-params';
import { readLiveSnapshot } from '@broker/live-params/server';
import type { Queryable } from '@broker/money';
import { getPool } from './db';
import { getTenantStartBalance } from './tenant';

const store = globalThis as unknown as { __cabinetLiveSnapshot?: () => Promise<LiveSnapshot | null> };

export function getLiveSnapshot(): Promise<LiveSnapshot | null> {
  store.__cabinetLiveSnapshot ??= createCachedLoader(() => readLiveSnapshot(getPool() as unknown as Queryable));
  return store.__cabinetLiveSnapshot();
}

async function startBalanceCents(): Promise<number | null> {
  const b = await getTenantStartBalance();
  return b.state === 'set' ? b.cents : null;
}

async function labels(locale: string): Promise<LiveLabels> {
  const t = await getTranslations({ locale, namespace: 'liveParams' });
  return { supportAlwaysOpen: t('supportAlwaysOpen') };
}

export function withLiveParams<T>(data: T, locale: string): Promise<T> {
  return resolveLiveContent(data, locale, { snapshot: getLiveSnapshot, startBalanceCents, labels });
}
