import { localizedPath } from '@broker/utils/locales';
import { getSiteLanguages } from '@/lib/site-languages';
import { SITE_URL } from '@/lib/site';

/** Абсолютный адрес страницы витрины с учётом языка (для JSON-LD). */
export async function absoluteUrl(path: string, locale: string): Promise<string> {
  const site = await getSiteLanguages();
  return `${SITE_URL.replace(/\/$/, '')}${localizedPath(path, locale, site.defaultLanguage)}`;
}
