import { redirect as nextRedirect } from 'next/navigation';
import { localizedPath } from '@broker/utils/locales';
import { getSiteLanguages } from '@/lib/site-languages';

export async function localeHref(href: string, locale: string): Promise<string> {
  const site = await getSiteLanguages();
  const target = (site.languages as readonly string[]).includes(locale) ? locale : site.defaultLanguage;
  return localizedPath(href, target, site.defaultLanguage);
}

export async function redirect({ href, locale }: { href: string; locale: string }): Promise<never> {
  nextRedirect(await localeHref(href, locale));
}
