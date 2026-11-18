import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { SiteFooter as UiSiteFooter, type SiteFooterProps as UiProps } from '@broker/ui';

export type SiteFooterProps = Omit<UiProps, 'copyright' | 'renderLink'>;

export function SiteFooter(props: SiteFooterProps) {
  const t = useTranslations('footer');
  return (
    <UiSiteFooter
      {...props}
      copyright={t('copyright', { year: new Date().getFullYear(), brand: props.brandName })}
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
