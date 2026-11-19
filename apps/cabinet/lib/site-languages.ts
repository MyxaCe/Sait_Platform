import { readTenantSlug } from '@broker/tenant';
import type { SiteLanguages } from '@broker/utils/locales';
import { fetchSiteLanguages, settle } from '@broker/utils/site-languages';

let lastGood: SiteLanguages | null = null;

export async function getSiteLanguages(): Promise<SiteLanguages> {
  const slug = readTenantSlug(process.env.SITE_SLUG);
  const result = await fetchSiteLanguages({
    baseUrl: process.env.CMS_API_URL,
    slug,
    apiKey: process.env.CMS_API_KEY,
    fetchInit: {
      next: { revalidate: 60, tags: ['cms:site', `cms:site:${slug ?? 'none'}`] },
    } as RequestInit,
  });
  if (result.state === 'ok') {
    lastGood = result.value;
    return result.value;
  }
  if (result.state === 'failed') {
    console.error(`[site-languages] карточка сайта недоступна (${result.reason}) — ${lastGood ? 'последний удачный ответ' : 'умолчание ru/en'}`);
  }
  return settle(result, lastGood);
}
