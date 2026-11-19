'use client';

import { useLocale, useTranslations } from 'next-intl';
import { LanguageSwitcher } from '@broker/ui';
import { LOCALE_AUTONYMS, localizedPath } from '@broker/utils/locales';
import { usePathname } from '@/i18n/navigation';
import { useSiteLanguages } from '@/i18n/site-languages-context';

export function LangSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations('common');
  const { languages, defaultLanguage } = useSiteLanguages();

  return (
    <LanguageSwitcher
      current={locale}
      label={t('language')}
      className={className}
      options={languages.map((l) => ({
        locale: l,
        label: LOCALE_AUTONYMS[l],
        href: localizedPath(pathname, l, defaultLanguage),
      }))}
    />
  );
}
