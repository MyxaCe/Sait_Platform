import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { QuotesTicker } from '@/features/quotes/QuotesTicker';
import { getCms } from '@/lib/cms';

interface LayoutProps {
  children: React.ReactNode;
  params: { locale: string };
}

export default async function MarketingLayout({ children, params }: LayoutProps) {
  const locale = params.locale === 'en' ? 'en' : 'ru';
  // Навигация и бренд — из CMS (теги cms:brand / cms:navigation),
  // инвалидация вебхуком POST /api/revalidate
  const [brand, navigation] = await Promise.all([
    getCms('brand', { locale }),
    getCms('navigation', { locale }),
  ]);

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader brandName={brand.name} nav={navigation.header} />
      <QuotesTicker />
      <main className="flex-1">{children}</main>
      <SiteFooter
        columns={navigation.footer.columns}
        riskWarning={navigation.footer.riskWarning}
        brandName={brand.name}
      />
    </div>
  );
}
