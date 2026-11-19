import { redirect as nextRedirect } from 'next/navigation';
import { localizedPath } from '@broker/utils/locales';
import { getSiteLanguages } from '@/lib/site-languages';

export async function redirect({ href, locale }: { href: string; locale: string }): Promise<never> {
  const { defaultLanguage } = await getSiteLanguages();
  nextRedirect(localizedPath(href, locale, defaultLanguage));
}
