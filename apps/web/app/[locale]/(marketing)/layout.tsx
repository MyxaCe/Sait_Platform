import { getTranslations } from 'next-intl/server';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { TickerGate } from '@/features/quotes/TickerGate';
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

  // Тикер: здесь считается ТОЛЬКО редакционная часть — инструменты
  // страницы из CMS. Это всё, что можно честно посчитать на сборке.
  //
  // Два остальных сомножителя рантаймовые, и ни один из них отсюда не
  // спрашивается:
  //
  //  - ДОСТУП сайта (allow-list карточки, ADR-028) — WEB-07. Прежде
  //    макет звал `getTenantAccess()` прямо тут, и на сборке, где
  //    `CMS_API_URL` нет, ответ «не настроено» замерзал в разметке
  //    каждой страницы: витрина сообщала поломку там, где её не было.
  //  - КАТАЛОГ MDS (что реально стримится, ADR-024) — WEB-08, Р-050.
  //    Прежде макет звал `getMdsSymbols()` прямо тут, и на сборке, где
  //    `MDS_HTTP_URL` нет, каталог не читался; `null` читался как
  //    «фильтра нет», и в строку уезжал зашитый `DEFAULT_TICKER_SYMBOLS`
  //    — символы, про которые никто не подтверждал, что они вообще
  //    транслируются. Выдуманное рядом с живыми ценами.
  //
  // Спросить их рантайм-вызовом прямо отсюда тоже нельзя — это увело бы
  // в динамику всю витрину, а она остаётся редакционной границей
  // (Р-030, п. 2). Поэтому оба вопроса задаёт островок `TickerGate`
  // через `GET /api/tenant/access` и `GET /api/quotes/catalog`.
  // Fail-closed на обеих: пока ответа нет — строки нет, и ни одно
  // состояние не открывает её молча.
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
      <SiteFooter
        columns={navigation.footer.columns}
        riskWarning={navigation.footer.riskWarning}
        brandName={brand.name}
        socials={brand.socials}
      />
    </div>
  );
}
