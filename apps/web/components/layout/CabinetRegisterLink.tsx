'use client';

import { useLocale } from 'next-intl';
import type { ComponentProps } from 'react';
import { useSiteLanguages } from '@/i18n/site-languages-context';
import { cabinetRegisterHref } from '@/lib/cabinet-links';

export function CabinetRegisterLink({ href, ...rest }: ComponentProps<'a'> & { href: string }) {
  const locale = useLocale();
  const { defaultLanguage } = useSiteLanguages();
  return <a href={cabinetRegisterHref(href, locale, defaultLanguage)} {...rest} />;
}
