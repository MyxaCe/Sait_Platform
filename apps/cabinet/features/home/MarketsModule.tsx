'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRealtimeQuotes } from '@broker/realtime';
import { cn, PriceChange } from '@broker/ui';
import { formatPrice } from '@broker/utils';
import { Link } from '@/i18n/navigation';
import { terminalPageHref } from '@/features/trade/terminal-href';
import type { CabinetHomeModule } from '@broker/api-client';
import type { MarketInstrument, MarketsData } from '@/lib/home';
import { selectGainers } from './markets-gainers';
import { describeNotice } from './markets-notice';
import { useMarketText } from '../shell/market-text';

type MarketsConfig = Extract<CabinetHomeModule, { type: 'markets' }>;
type TabKey = 'assets' | 'popular' | 'newListing' | 'favorites' | 'gainers' | 'volume';

const NO_INSTRUMENTS: MarketInstrument[] = [];

export function MarketsModule({ config, data }: { config: MarketsConfig; data: MarketsData }) {
  const t = useTranslations('home');
  const instruments = data.state === 'ok' ? data.instruments : NO_INSTRUMENTS;
  const symbols = useMemo(() => instruments.map((i) => i.symbol), [instruments]);
  const icons = useMemo(
    () => new Map(instruments.filter((i) => i.icon).map((i) => [i.symbol, i.icon!])),
    [instruments],
  );
  const quotes = useRealtimeQuotes(symbols);
  const marketText = useMarketText();

  const tabs = useMemo(() => {
    const list: { key: TabKey; label: string }[] = [];
    if (config.tabs.assets) list.push({ key: 'assets', label: t('tabAssets') });
    if (config.tabs.popular) list.push({ key: 'popular', label: t('tabPopular') });
    if (config.tabs.newListing && config.newListingSymbols.length > 0)
      list.push({ key: 'newListing', label: t('tabNewListing') });
    if (config.tabs.gainers) list.push({ key: 'gainers', label: t('tabGainers') });
    return list;
  }, [config, t]);

  const [active, setActive] = useState<TabKey>(tabs[0]?.key ?? 'assets');

  const rows = useMemo(() => {
    const byTab = () => {
      switch (active) {
        case 'popular':
          return quotes.slice(0, 3);
        case 'newListing':
          return quotes.filter((q) => config.newListingSymbols.includes(q.symbol));
        case 'gainers':
          return selectGainers(quotes);
        default:
          return quotes;
      }
    };
    return byTab();
  }, [active, quotes, config.newListingSymbols]);

  const notice = describeNotice(data, tabs.length);
  if (notice) {
    return (
      <MarketsShell title={t('marketsTitle')}>
        <div
          className="mt-4 rounded-xl border border-border bg-primary/[0.03] px-4 py-5 text-sm"
          data-reason={notice.reason}
        >
          <p className="font-medium text-primary">{t(notice.titleKey)}</p>
          <p className="mt-1 text-secondary">{t(notice.textKey)}</p>
        </div>
      </MarketsShell>
    );
  }

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-border bg-elevated p-4 sm:p-5" data-home-markets>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">{t('marketsTitle')}</h2>
        <div className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(tab.key)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm transition-colors',
                active === tab.key
                  ? 'bg-accent/15 font-medium text-accent'
                  : 'text-secondary hover:bg-primary/5 hover:text-primary',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Длинный список (сотни инструментов) прокручивается внутри блока, а не растягивает страницу. */}
      <div className="mt-4 max-h-[26rem] min-h-0 flex-1 overflow-auto overscroll-contain xl:max-h-[30rem]" data-markets-scroll>
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-elevated">
            <tr className="text-left text-xs text-secondary">
              <th className="pb-2 font-normal">{t('colInstrument')}</th>
              <th className="pb-2 font-normal">{t('colPrice')}</th>
              <th className="pb-2 font-normal">{t('colChange')}</th>
              <th className="pb-2">
                <span className="sr-only">{t('trade')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.symbol} className="border-t border-border">
                <td className="py-3 pr-2">
                  <span className="flex items-center gap-2.5">
                    {icons.has(q.symbol) ? (
                      // eslint-disable-next-line @next/next/no-img-element -- SVG с MDS
                      <img
                        src={icons.get(q.symbol)}
                        alt=""
                        width={24}
                        height={24}
                        loading="lazy"
                        className="h-6 w-6 shrink-0 rounded-full"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/5 text-[10px] font-semibold text-secondary"
                      >
                        {q.symbol.slice(0, 2)}
                      </span>
                    )}
                    <span>
                      <span className="font-medium">{q.symbol}</span>
                      <span className="ml-2 hidden text-secondary sm:inline">{q.name}</span>
                    </span>
                  </span>
                </td>
                <td className="whitespace-nowrap py-3 pr-2 tabular-nums">
                  {formatPrice(q.price, q.digits)}
                  {marketText(q.market) && (
                    <span className="block text-[11px] text-secondary" data-market={q.market?.status}>
                      {marketText(q.market)}
                    </span>
                  )}
                </td>
                <td className="py-3">
                  <PriceChange value={q.changePercent} />
                </td>
                <td className="py-3 pl-2 text-right">
                  <Link
                    href={terminalPageHref('real', q.symbol)}
                    className="whitespace-nowrap text-xs text-accent hover:underline"
                    aria-label={`${t('trade')} ${q.symbol}`}
                  >
                    <span className="hidden sm:inline">{t('trade')}</span>
                    <span aria-hidden className="sm:hidden">→</span>
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-secondary">
                  {t('marketsEmpty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MarketsShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-elevated p-5">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}
