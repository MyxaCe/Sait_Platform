import { getTranslations } from 'next-intl/server';
import { resolveLiveContent, type LiveLabels } from '@broker/live-params';
import { EDITORIAL_REUSE_WINDOW_SECONDS, fetchTenantConfig, readTenantSlug } from '@broker/tenant';
import { fetchLiveSnapshot } from './platform-terms';

async function startBalanceCents(): Promise<number | null> {
  const slug = readTenantSlug(process.env.SITE_SLUG);
  const { startBalance } = await fetchTenantConfig({
    baseUrl: process.env.CMS_API_URL,
    slug,
    apiKey: process.env.CMS_API_KEY || undefined,
    fetchInit: {
      next: { revalidate: EDITORIAL_REUSE_WINDOW_SECONDS, tags: ['cms:brand', `cms:brand:${slug}`] },
    } as RequestInit,
  });
  return startBalance.state === 'set' ? startBalance.cents : null;
}

async function labels(locale: string): Promise<LiveLabels> {
  const t = await getTranslations({ locale, namespace: 'liveParams' });
  return { supportAlwaysOpen: t('supportAlwaysOpen') };
}

export function withLiveParams<T>(data: T, locale: string): Promise<T> {
  return resolveLiveContent(data, locale, { snapshot: () => fetchLiveSnapshot(), startBalanceCents, labels });
}
