import { getTranslations } from 'next-intl/server';
import { DEFAULT_TICKER_SYMBOLS } from '@broker/realtime';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { TickerGate } from '@/features/quotes/TickerGate';
import { getCms } from '@/lib/cms';
import { getMdsSymbols } from '@/lib/mds';

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

  // Тикер: инструменты страницы ∩ реально стримящееся в MDS (замершие
  // мок-цены рядом с живыми — обман, ADR-024). Это ВСЁ, что можно
  // посчитать на сборке.
  //
  // Третий сомножитель — ДОСТУП сайта (allow-list карточки сайта,
  // ADR-028) — спрашивается в рантайме и потому здесь не спрашивается
  // вовсе (WEB-07). Прежде макет звал `getTenantAccess()` прямо тут, и
  // на сборке, где `CMS_API_URL` нет, ответ «не настроено» замерзал в
  // разметке каждой из 156 страниц: витрина сообщала поломку там, где её
  // не было. Спросить границу рантайм-вызовом прямо отсюда тоже нельзя —
  // это увело бы в динамику всю витрину, а она остаётся редакционной
  // границей (Р-030, п. 2).
  //
  // Поэтому вопрос задаёт островок `TickerGate` через
  // `GET /api/tenant/access`. Fail-closed сохранён на той стороне: пока
  // ответа нет — тикера нет, и ни одно состояние его не открывает молча.
  const mdsSymbols = await getMdsSymbols();
  const t = await getTranslations({ locale, namespace: 'instruments' });

  const pageSymbols = new Set(instruments.items.map((i) => i.symbol));
  const tickerCandidates = mdsSymbols
    ? [...mdsSymbols].filter((s) => pageSymbols.has(s))
    : DEFAULT_TICKER_SYMBOLS.filter((s) => pageSymbols.has(s));

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader brandName={brand.name} logo={brand.logo} nav={navigation.header} />
      <TickerGate
        candidates={tickerCandidates}
        emptyText={t('accessEmptyStrip')}
        unavailableText={t('accessUnavailableStrip')}
      />
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
