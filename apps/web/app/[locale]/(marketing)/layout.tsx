import { getTranslations } from 'next-intl/server';
import { DEFAULT_TICKER_SYMBOLS } from '@broker/realtime';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { AccessNotice } from '@/features/instruments/AccessNotice';
import { QuotesTicker } from '@/features/quotes/QuotesTicker';
import { getCms } from '@/lib/cms';
import { getMdsSymbols } from '@/lib/mds';
import { accessNotice, getTenantAccess, isSymbolAllowed } from '@/lib/tenant';

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
  // с живыми — обман, ADR-024).
  //
  // Граница fail-closed (Р-025): закрыта — тикера нет вовсе, и на его месте
  // стоит строка с причиной. Пустая бегущая строка молча исчезла бы с
  // каждой страницы сайта — это то же «отказ выглядит как отсутствие
  // функции», только размазанное по всей витрине.
  const [mdsSymbols, access] = await Promise.all([getMdsSymbols(), getTenantAccess()]);
  const notice = accessNotice(access);
  const t = await getTranslations({ locale, namespace: 'instruments' });

  const allowed = new Set(
    instruments.items.map((i) => i.symbol).filter((s) => isSymbolAllowed(access, s)),
  );
  const tickerSymbols = mdsSymbols
    ? [...mdsSymbols].filter((s) => allowed.has(s))
    : DEFAULT_TICKER_SYMBOLS.filter((s) => allowed.has(s));

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader brandName={brand.name} logo={brand.logo} nav={navigation.header} />
      {notice ? (
        <AccessNotice
          variant="strip"
          state={notice.state}
          text={t(notice.stripKey)}
          reason={notice.reason}
        />
      ) : (
        <QuotesTicker symbols={tickerSymbols} />
      )}
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
