import { getTranslations } from 'next-intl/server';
import { Money } from '@broker/ui';
import { describeSlippage } from '@/lib/slippage';
import type { ClosedDealsOutcome } from '@/lib/terminal/client';

export async function ClosedDeals({ outcome }: { outcome: ClosedDealsOutcome }) {
  if (outcome.state !== 'available' || outcome.deals.length === 0) return null;
  const t = await getTranslations('history');

  return (
    <section className="space-y-2" aria-labelledby="closed-deals">
      <h2 id="closed-deals" className="text-sm font-semibold">
        {t('closedDealsTitle')}
      </h2>
      <p className="text-xs text-secondary">{t('closedDealsHint')}</p>
      <ul className="divide-y divide-border rounded-2xl border border-border bg-elevated">
        {outcome.deals.map((deal, i) => {
          const price = (value: number) => value.toFixed(deal.priceDigits);
          const slippage = describeSlippage({
            execution: deal.exit,
            level: deal.level,
            side: deal.side,
            digits: deal.priceDigits,
          });
          return (
            <li key={`${deal.symbol}-${i}`} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">
                  {t('columns', { side: deal.side, volume: String(deal.volume), symbol: deal.symbol })}
                </span>
                <span className="text-sm font-medium">
                  <Money minor={deal.pnlCents} currency="USD" signed tone="auto" />
                </span>
              </div>
              <p className="mt-0.5 text-xs tabular-nums text-secondary">
                {t('prices', { entry: price(deal.entry), exit: price(deal.exit) })}
              </p>
              {deal.level !== null && slippage.kind !== 'unknown' ? (
                <p className="mt-1.5 text-xs">
                  {slippage.kind === 'against'
                    ? t('slippageAgainst', { amount: price(slippage.amount), level: price(deal.level) })
                    : slippage.kind === 'favour'
                      ? t('slippageFavour', { amount: price(slippage.amount), level: price(deal.level) })
                      : t('slippageNone', { level: price(deal.level) })}
                </p>
              ) : null}
              {deal.acrossGap === true ? <p className="mt-1 text-xs text-secondary">{t('gap')}</p> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
