import { getFormatter, getTranslations } from 'next-intl/server';
import type { DepositView, WithdrawalView } from '@/lib/money';

/** История заявок ввода/вывода со статусами (только серверный рендер). */

function usdt(cents: number | null): string {
  return cents === null ? '—' : `${(cents / 100).toFixed(2)} USDT`;
}

export async function DepositHistory({ items }: { items: DepositView[] }) {
  const t = await getTranslations('money');
  const format = await getFormatter();
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-secondary">{t('historyDeposits')}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-secondary">{t('historyEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-elevated text-sm">
          {items.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="min-w-0">
                <a
                  href={`https://tronscan.org/#/transaction/${d.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-mono text-xs text-accent"
                >
                  {d.txHash.slice(0, 16)}…{d.txHash.slice(-6)}
                </a>
                <span className="text-xs text-secondary">
                  {format.dateTime(d.claimedAt, { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </span>
              <span className="text-right">
                <span className="block tabular-nums">{usdt(d.amountMinor)}</span>
                <span className={`block text-xs ${d.status === 'rejected' ? 'text-negative' : 'text-secondary'}`}>
                  {t.has(`status.${d.status}`) ? t(`status.${d.status}`) : d.status}
                  {d.rejectReason && t.has(`rejectReason.${d.rejectReason}`)
                    ? ` — ${t(`rejectReason.${d.rejectReason}`)}`
                    : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export async function WithdrawalHistory({ items }: { items: WithdrawalView[] }) {
  const t = await getTranslations('money');
  const format = await getFormatter();
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-secondary">{t('historyWithdrawals')}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-secondary">{t('historyEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-elevated text-sm">
          {items.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="min-w-0">
                <span className="block truncate font-mono text-xs">{w.toAddress}</span>
                <span className="text-xs text-secondary">
                  {format.dateTime(w.requestedAt, { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
                {w.payoutTxHash ? (
                  <a
                    href={`https://tronscan.org/#/transaction/${w.payoutTxHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block font-mono text-xs text-accent"
                  >
                    {w.payoutTxHash.slice(0, 16)}…
                  </a>
                ) : null}
              </span>
              <span className="text-right">
                <span className="block tabular-nums">{usdt(w.amountMinor)}</span>
                <span className={`block text-xs ${w.status === 'rejected' ? 'text-negative' : 'text-secondary'}`}>
                  {t.has(`status.${w.status}`) ? t(`status.${w.status}`) : w.status}
                  {w.status === 'rejected' && w.rejectReason && t.has(`errors.terminal_${w.rejectReason}`)
                    ? ` — ${t(`errors.terminal_${w.rejectReason}`)}`
                    : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
