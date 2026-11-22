import { pageLocale } from '@/lib/locale';
import { getTranslations } from 'next-intl/server';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SupportFab } from '@/components/layout/SupportFab';
import { TickerGate } from '@/features/quotes/TickerGate';
import { getCms } from '@/lib/cms';

interface LayoutProps {
  children: React.ReactNode;
  params: { locale: string };
}

export default async function MarketingLayout({ children, params }: LayoutProps) {
  const locale = pageLocale(params.locale);
  const [brand, navigation, instruments] = await Promise.all([
    getCms('brand', { locale }),
    getCms('navigation', { locale }),
    getCms('instruments', { locale }),
  ]);

  const t = await getTranslations({ locale, namespace: 'instruments' });
  const candidates = instruments.items.map((i) => i.symbol);

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader brandName={brand.name} logo={brand.logo} nav={navigation.header} />
      <TickerGate
        candidates={candidates}
        emptyText={t('accessEmptyStrip')}
        unavailableText={t('accessUnavailableStrip')}
        quotesUnavailableText={t('quotesUnavailableStrip')}
        quotesEmptyText={t('quotesEmptyStrip')}
      />
      <main className="flex-1">{children}</main>
      <SupportFab locale={locale} />
      <SiteFooter
        columns={navigation.footer.columns}
        riskWarning={navigation.footer.riskWarning}
        brandName={brand.name}
        socials={brand.socials}
      />
    </div>
  );
}
