import { readTenantSlug } from '@broker/tenant';
import { readSiteLanguages, type SiteLanguages } from '@broker/utils/locales';
import { lastGoodKey, loadLastGood, saveLastGood } from './cms-last-good';
import { fetchSiteLanguages, settle } from './site-languages-source';

export const SITE_LANGUAGES_REVALIDATE_SECONDS = 60;

export async function getSiteLanguages(): Promise<SiteLanguages> {
  const slug = readTenantSlug(process.env.SITE_SLUG);
  const result = await fetchSiteLanguages({
    baseUrl: process.env.CMS_API_URL,
    slug,
    apiKey: process.env.CMS_API_KEY,
    fetchInit: {
      next: {
        revalidate: SITE_LANGUAGES_REVALIDATE_SECONDS,
        tags: ['cms:brand', `cms:brand:${slug ?? 'none'}`, 'cms:site', `cms:site:${slug ?? 'none'}`],
      },
    } as RequestInit,
  });
  if (!slug) return settle(result, null);
  const key = lastGoodKey('site-languages', slug, 'all', {});
  if (result.state === 'ok') {
    await saveLastGood(key, result.value);
    return result.value;
  }
  const saved = await loadLastGood(key);
  if (result.state === 'failed') {
    console.error(`[site-languages] карточка сайта недоступна (${result.reason}) — ${saved ? 'последний удачный ответ' : 'умолчание ru/en'}`);
  }
  return settle(result, saved ? readSiteLanguages(saved.data) : null);
}
