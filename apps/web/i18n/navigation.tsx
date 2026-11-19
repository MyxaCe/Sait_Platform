'use client';

import NextLink from 'next/link';
import { usePathname as useNextPathname } from 'next/navigation';
import { useLocale } from 'next-intl';
import { forwardRef, type ComponentProps } from 'react';
import { localizedPath, stripLocalePrefix } from '@broker/utils/locales';
import { useSiteLanguages } from './site-languages-context';

type LinkProps = Omit<ComponentProps<typeof NextLink>, 'href'> & { href: string; locale?: string };

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ href, locale, ...rest }, ref) {
  const current = useLocale();
  const { defaultLanguage } = useSiteLanguages();
  const target = /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') ? href : localizedPath(href, locale ?? current, defaultLanguage);
  return <NextLink ref={ref} href={target} {...rest} />;
});

export function usePathname(): string {
  return stripLocalePrefix(useNextPathname() ?? '/').path;
}
