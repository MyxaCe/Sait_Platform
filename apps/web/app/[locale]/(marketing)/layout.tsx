import { pageLocale } from '@/lib/locale';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SupportFab } from '@/components/layout/SupportFab';
import { getCms } from '@/lib/cms';
import { emptySections, withoutEmptyColumns, withoutEmptyLinks } from '@/lib/empty-sections';
import { getSiteLanguages } from '@/lib/site-languages';

interface LayoutProps {
  children: React.ReactNode;
  params: { locale: string };
}

export default async function MarketingLayout({ children, params }: LayoutProps) {
  const locale = pageLocale(params.locale);
  const [brand, navigation, empty, site] = await Promise.all([
    getCms('brand', { locale }),
    getCms('navigation', { locale }),
    emptySections(locale),
    getSiteLanguages(),
  ]);
  const header = withoutEmptyLinks(navigation.header, empty, site.languages);
  const footerColumns = withoutEmptyColumns(navigation.footer.columns, empty, site.languages);

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader brandName={brand.name} logo={brand.logo} logoMode={brand.logoMode} nav={header} />
      <main className="flex-1">{children}</main>
      <SupportFab locale={locale} />
      <SiteFooter
        columns={footerColumns}
        riskWarning={navigation.footer.riskWarning}
        brandName={brand.name}
        socials={brand.socials}
        legalEntity={brand.legalEntity}
      />
    </div>
  );
}
