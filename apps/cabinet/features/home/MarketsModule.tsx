'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRealtimeQuotes } from '@broker/realtime';
import { cn, PriceChange } from '@broker/ui';
import { formatPrice } from '@broker/utils';
import { Link } from '@/i18n/navigation';
import type { CabinetHomeModule } from '@broker/api-client';
import type { MarketInstrument } from '@/lib/home';

type MarketsConfig = Extract<CabinetHomeModule, { type: 'markets' }>;
type TabKey = 'assets' | 'popular' | 'newListing' | 'favorites' | 'gainers' | 'volume';

/**
 * Модуль «Рынки»: живые котировки MDS, табы — по конфигу CMS.
 * «Объём 24ч» и «Избранное» появятся в Ф3 (расширение MDS / per-user данные) —
 * до этого табы скрываются, даже если включены в CMS.
 */
export function MarketsModule({
  config,
  instruments,
}: {
  config: MarketsConfig;
  instruments: MarketInstrument[];
}) {
  const t = useTranslations('home');
  const symbols = useMemo(() => instruments.map((i) => i.symbol), [instruments]);
  const icons = useMemo(
    () => new Map(instruments.filter((i) => i.icon).map((i) => [i.symbol, i.icon!])),
    [instruments],
  );
  const quotes = useRealtimeQuotes(symbols);

  const tabs = useMemo(() => {
    const list: { key: TabKey; label: string }[] = [];
    if (config.tabs.assets) list.push({ key: 'assets', label: t('tabAssets') });
    if (config.tabs.popular) list.push({ key: 'popular', label: t('tabPopular') });
    if (config.tabs.newListing && config.newListingSymbols.length > 0)
      list.push({ key: 'newListing', label: t('tabNewListing') });
    if (config.tabs.gainers) list.push({ key: 'gainers', label: t('tabGainers') });
    // favorites/volume — Ф3 (per-user данные / volume24h в MDS)
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
          return [...quotes].filter((q) => q.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent);
        default:
          return quotes;
      }
    };
    return byTab();
  }, [active, quotes, config.newListingSymbols]);

  if (instruments.length === 0 || tabs.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-elevated p-5">
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

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-96 text-sm">
          <thead>
            <tr className="text-left text-xs text-secondary">
              <th className="pb-2 font-normal">{t('colInstrument')}</th>
              <th className="pb-2 font-normal">{t('colPrice')}</th>
              <th className="pb-2 font-normal">{t('colChange')}</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.symbol} className="border-t border-border">
                <td className="py-3">
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
                <td className="py-3 tabular-nums">{formatPrice(q.price, q.digits)}</td>
                <td className="py-3">
                  <PriceChange value={q.changePercent} />
                </td>
                <td className="py-3 text-right">
                  <Link href="/trade" className="text-xs text-accent hover:underline">
                    {t('trade')}
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
