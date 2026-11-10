import { getFormatter, getTranslations } from 'next-intl/server';
import { EmptyState, Money, StatusBadge, ToneBadge, cn, statusKeyOf } from '@broker/ui';
import { Link } from '@/i18n/navigation';
import { NavIcon } from '@/features/shell/NavIcon';
import { toMoneyOps } from '@/features/money/MoneyHistory';
import type { TradeRow } from '@/lib/history';
import type { DepositView, WithdrawalView } from '@/lib/money';

type Item =
  | { kind: 'trade'; at: Date; trade: TradeRow }
  | { kind: 'deposit'; at: Date; item: DepositView }
  | { kind: 'withdrawal'; at: Date; item: WithdrawalView };

/**
 * «Последние операции» на главной (десктоп-раскладка): 5 последних событий
 * реального счёта — сделки и ввод/вывод — компактными строками, со ссылкой
 * на полную «Историю». Те же данные, что в «Истории», только чтение.
 */
export async function RecentActivity({
  trades,
  deposits,
  withdrawals,
  currency,
  limit = 5,
}: {
  trades: TradeRow[];
  deposits: DepositView[];
  withdrawals: WithdrawalView[];
  currency: string;
  limit?: number;
}) {
  const t = await getTranslations('home');
  const tm = await getTranslations('money');
  const th = await getTranslations('history');
  const format = await getFormatter();
  const items: Item[] = [
    ...trades.map((tr) => ({ kind: 'trade' as const, at: tr.executedAt, trade: tr })),
    ...toMoneyOps(deposits, withdrawals).map((op) =>
      op.kind === 'deposit'
        ? { kind: 'deposit' as const, at: op.at, item: op.item }
        : { kind: 'withdrawal' as const, at: op.at, item: op.item },
    ),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, limit);

  const when = (d: Date) => format.dateTime(d, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const status = (domain: 'deposit' | 'withdrawal', s: string) => {
    const own = `status.${domain}_${s}`;
    const label = tm.has(own) ? tm(own) : tm.has(`status.${s}`) ? tm(`status.${s}`) : s;
    const key = statusKeyOf(`${domain}_${s}`);
    return key ? <StatusBadge status={key} label={label} plain /> : <ToneBadge tone="neutral" plain>{label}</ToneBadge>;
  };

  return (
    <section aria-labelledby="home-recent" className="flex h-full flex-col rounded-2xl border border-border bg-elevated">
      <div className="flex items-baseline justify-between gap-3 px-5 pb-2 pt-4">
        <h2 id="home-recent" className="font-semibold">
          {t('recentTitle')}
        </h2>
        <Link href="/history" className="text-sm font-medium text-accent hover:underline">
          {t('recentAll')} →
        </Link>
      </div>
      {items.length === 0 ? (
        <EmptyState size="compact" title={t('recentEmpty')} className="flex-1 justify-center" />
      ) : (
        <ul className="flex-1 divide-y divide-border px-2 pb-2">
          {items.map((it) => {
            const key = it.kind === 'trade' ? `t-${it.trade.id}` : `${it.kind}-${it.item.id}`;
            if (it.kind === 'trade') {
              const buy = it.trade.side === 'buy';
              return (
                <li key={key} className="flex items-center gap-3 px-3 py-2.5">
                  <span
                    aria-hidden
                    className={cn(
                      'grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
                      buy ? 'bg-info/10 text-info' : 'bg-warning/10 text-warning',
                    )}
                  >
                    {buy ? '↗' : '↘'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      <span className="font-medium">{it.trade.symbol}</span>{' '}
                      <span className={buy ? 'text-info' : 'text-warning'}>{th(buy ? 'buy' : 'sell')}</span>
                    </span>
                    <span className="block text-xs tabular-nums text-muted">{when(it.at)}</span>
                  </span>
                  <span className="shrink-0 text-right text-sm font-medium">
                    {it.trade.realizedPnlCents === null ? (
                      <span className="text-xs font-normal text-muted">{th('opening')}</span>
                    ) : (
                      <Money minor={it.trade.realizedPnlCents} currency={currency} signed tone="auto" />
                    )}
                  </span>
                </li>
              );
            }
            const dep = it.kind === 'deposit';
            const minor = it.item.amountMinor;
            return (
              <li key={key} className="flex items-center gap-3 px-3 py-2.5">
                <span
                  aria-hidden
                  className={cn(
                    'grid size-8 shrink-0 place-items-center rounded-full',
                    dep ? 'bg-positive/10 text-positive' : 'bg-primary/[0.06] text-secondary',
                  )}
                >
                  <NavIcon name={dep ? 'deposit' : 'withdraw'} className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{tm(dep ? 'opDeposit' : 'opWithdrawal')}</span>
                  <span className="block text-xs tabular-nums text-muted">{when(it.at)}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                  <span className="text-sm font-medium">
                    <Money minor={minor === null ? null : dep ? minor : -minor} currency="USDT" signed />
                  </span>
                  {status(dep ? 'deposit' : 'withdrawal', it.item.status)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
