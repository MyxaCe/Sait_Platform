import { pageLocale } from '@/lib/locale';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SupportFab } from '@/components/layout/SupportFab';
import { getCms } from '@/lib/cms';

interface LayoutProps {
  children: React.ReactNode;
  params: { locale: string };
}

export default async function MarketingLayout({ children, params }: LayoutProps) {
  const locale = pageLocale(params.locale);
  const [brand, navigation] = await Promise.all([
    getCms('brand', { locale }),
    getCms('navigation', { locale }),
  ]);

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader brandName={brand.name} logo={brand.logo} nav={navigation.header} />
      <main className="flex-1">{children}</main>
      <SupportFab locale={locale} />
      <SiteFooter
        columns={navigation.footer.columns}
        riskWarning={navigation.footer.riskWarning}
        brandName={brand.name}
        socials={brand.socials}
        legalEntity={brand.legalEntity}
      />
    </div>
  );
}
