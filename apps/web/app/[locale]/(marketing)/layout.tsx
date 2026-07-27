import { DEFAULT_TICKER_SYMBOLS } from '@broker/realtime';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { QuotesTicker } from '@/features/quotes/QuotesTicker';
import { getCms } from '@/lib/cms';
import { getMdsSymbols } from '@/lib/mds';
import { getTenantAllowList } from '@/lib/tenant';

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

  // Тикер: инструменты страницы ∩ ДОСТУП сайта (allow-list карточки сайта,
  // ADR-028) ∩ реально стримящееся в MDS (замершие мок-цены рядом
  // с живыми — обман, ADR-024)
  const [mdsSymbols, allowList] = await Promise.all([getMdsSymbols(), getTenantAllowList()]);
  const allowed = new Set(
    instruments.items.map((i) => i.symbol).filter((s) => !allowList || allowList.has(s)),
  );
  const tickerSymbols = mdsSymbols
    ? [...mdsSymbols].filter((s) => allowed.has(s))
    : DEFAULT_TICKER_SYMBOLS.filter((s) => allowed.has(s));

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader brandName={brand.name} logo={brand.logo} nav={navigation.header} />
      <QuotesTicker symbols={tickerSymbols} />
      <main className="flex-1">{children}</main>
      <SiteFooter
        columns={navigation.footer.columns}
        riskWarning={navigation.footer.riskWarning}
        brandName={brand.name}
        socials={brand.socials}
      />
    </div>
  );
}
