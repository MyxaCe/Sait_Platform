'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { cn } from '@broker/ui';
import { formatCurrency } from '@broker/utils';
import { ACCOUNT_PRICING } from './plans';

/** Стоимость пункта для 1 стандартного лота EURUSD */
const PIP_VALUE_USD = 10;

export function CommissionCalculator() {
  const t = useTranslations('accounts.calc');
  const [lots, setLots] = useState(0.5);
  const [tradesPerMonth, setTradesPerMonth] = useState(40);

  const results = useMemo(() => {
    const rows = ACCOUNT_PRICING.map((acc) => {
      const spreadCost = acc.spreadPips * PIP_VALUE_USD * lots;
      const commission = acc.commissionPerLotRT * lots;
      const perTrade = spreadCost + commission;
      return { ...acc, perTrade, monthly: perTrade * tradesPerMonth };
    });
    const cheapest = Math.min(...rows.map((r) => r.monthly));
    return rows.map((r) => ({ ...r, isCheapest: r.monthly === cheapest }));
  }, [lots, tradesPerMonth]);

  return (
    <div className="rounded-3xl border border-border bg-card p-6 sm:p-8">
      <div className="grid gap-8 lg:grid-cols-[380px_1fr] lg:gap-12">
        {/* Входные параметры */}
        <div className="space-y-7">
          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="calc-lots" className="text-sm text-secondary">
                {t('volume')}
              </label>
              <output className="text-lg font-semibold tabular-nums text-primary">
                {t('lots', { lots: lots.toFixed(2) })}
              </output>
            </div>
            <input
              id="calc-lots"
              type="range"
              min={0.01}
              max={10}
              step={0.01}
              value={lots}
              onChange={(e) => setLots(Number(e.target.value))}
              className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-elevated accent-accent"
            />
            <div className="mt-1 flex justify-between text-xs text-secondary">
              <span>0.01</span>
              <span>10</span>
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="calc-trades" className="text-sm text-secondary">
                {t('trades')}
              </label>
              <output className="text-lg font-semibold tabular-nums text-primary">
                {tradesPerMonth}
              </output>
            </div>
            <input
              id="calc-trades"
              type="range"
              min={1}
              max={300}
              step={1}
              value={tradesPerMonth}
              onChange={(e) => setTradesPerMonth(Number(e.target.value))}
              className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-elevated accent-accent"
            />
            <div className="mt-1 flex justify-between text-xs text-secondary">
              <span>1</span>
              <span>300</span>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-secondary">{t('note')}</p>
        </div>

        {/* Результаты по каждому счёту */}
        <div className="grid gap-4 sm:grid-cols-3" aria-live="polite">
          {results.map((r) => (
            <div
              key={r.id}
              className={cn(
                'relative flex flex-col rounded-2xl border p-5 transition-colors',
                r.isCheapest ? 'border-positive/60 bg-positive/5' : 'border-border bg-elevated',
              )}
            >
              {r.isCheapest && (
                <span className="absolute -top-2.5 left-4 rounded-full bg-positive px-2.5 py-0.5 text-[11px] font-semibold text-base">
                  {t('cheapest')}
                </span>
              )}
              <h3 className="text-sm font-semibold text-primary">{r.name}</h3>
              <p className="mt-4 text-2xl font-bold tabular-nums text-primary">
                {formatCurrency(r.monthly)}
                <span className="block text-xs font-normal text-secondary">{t('perMonth')}</span>
              </p>
              <dl className="mt-4 space-y-2 border-t border-border pt-4 text-xs">
                <div className="flex justify-between">
                  <dt className="text-secondary">{t('perTrade')}</dt>
                  <dd className="tabular-nums text-primary">{formatCurrency(r.perTrade)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-secondary">{t('spread')}</dt>
                  <dd className="tabular-nums text-primary">{t('spreadUnit', { pips: r.spreadPips })}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-secondary">{t('commissionRT')}</dt>
                  <dd className="tabular-nums text-primary">
                    {r.commissionPerLotRT > 0 ? `$${r.commissionPerLotRT}` : '$0'}
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
