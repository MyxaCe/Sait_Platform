import { getTranslations } from 'next-intl/server';
import { Card } from '@/features/ui/Card';
import { Money } from '@/features/ui/Money';
import { describeSlippage } from '@/lib/slippage';
import type { ClosedDealsOutcome } from '@/lib/terminal/client';

export async function ClosedDeals({ outcome, currency = 'USD' }: { outcome: ClosedDealsOutcome; currency?: string }) {
  if (outcome.state !== 'available' || outcome.deals.length === 0) return null;
  const t = await getTranslations('history');

  return (
    <Card title={t('closedDealsTitle')} titleId="closed-deals" hint={t('closedDealsHint')} flush>
      <ul className="divide-y divide-border">
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
                  <Money minor={deal.pnlCents} currency={currency} signed tone="auto" />
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
    </Card>
  );
}
