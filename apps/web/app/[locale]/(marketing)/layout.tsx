import { DEFAULT_TICKER_SYMBOLS } from '@broker/realtime';
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
  // Навигация, бренд и allow-list инструментов — из CMS,
  // инвалидация вебхуком POST /api/revalidate
  const [brand, navigation, instruments] = await Promise.all([
    getCms('brand', { locale }),
    getCms('navigation', { locale }),
    getCms('instruments', { locale }),
  ]);

  // Тикер показывает только разрешённые CMS инструменты
  const allowed = new Set(instruments.items.map((i) => i.symbol));
  const tickerSymbols = DEFAULT_TICKER_SYMBOLS.filter((s) => allowed.has(s));

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader brandName={brand.name} nav={navigation.header} />
      <QuotesTicker symbols={tickerSymbols} />
      <main className="flex-1">{children}</main>
      <SiteFooter
        columns={navigation.footer.columns}
        riskWarning={navigation.footer.riskWarning}
        brandName={brand.name}
      />
    </div>
  );
}
