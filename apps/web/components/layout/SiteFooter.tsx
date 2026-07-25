import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { SiteFooter as UiSiteFooter, type SiteFooterProps as UiProps } from '@broker/ui';

export type SiteFooterProps = Omit<UiProps, 'copyright' | 'renderLink'>;

/**
 * Обёртка сайта над общим футером дизайн-системы (ADR-025):
 * локализованный копирайт + i18n-Link с сохранением клиентской навигации.
 */
export function SiteFooter(props: SiteFooterProps) {
  const t = useTranslations('footer');
  return (
    <UiSiteFooter
      {...props}
      copyright={t('copyright', { year: new Date().getFullYear() })}
      renderLink={(link) => (
        <Link
          href={link.href}
          className="text-sm text-secondary transition-colors hover:text-primary"
        >
          {link.label}
        </Link>
      )}
    />
  );
}
