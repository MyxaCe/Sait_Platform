import { useTranslations } from 'next-intl';
import type { LegalEntity } from '@broker/api-client';
import { REGULATION_PATH } from '@/features/legal/regulation';
import { Link } from '@/i18n/navigation';
import {
  SiteFooter as UiSiteFooter,
  footerLegalLines,
  type SiteFooterProps as UiProps,
} from '@broker/ui';


export type SiteFooterProps = Omit<UiProps, 'copyright' | 'renderLink' | 'legal'> & {
  legalEntity?: LegalEntity | null;
};

export function SiteFooter({ legalEntity, ...props }: SiteFooterProps) {
  const t = useTranslations('footer');
  const tLegal = useTranslations('legalEntity');
  const lines = footerLegalLines(legalEntity, {
    regNumber: (number) => tLegal('regNumber', { number }),
    license: (number) => (number ? tLegal('licenseNumber', { number }) : tLegal('license')),
  });
  return (
    <UiSiteFooter
      {...props}
      copyright={t('copyright', { year: new Date().getFullYear(), brand: props.brandName })}
      legal={
        lines && {
          ...lines,
          verifyLabel: tLegal('verifyLicense'),
          more: { href: REGULATION_PATH, label: tLegal('regulationLink') },
        }
      }
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
