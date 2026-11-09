import { getFormatter, getTranslations } from 'next-intl/server';
import { EmptyState, Money, StatusBadge, ToneBadge, cn, statusKeyOf } from '@broker/ui';
import type { DepositView, WithdrawalView } from '@/lib/money';
import { MachineValue } from './TxLink';

/**
 * История заявок ввода/вывода (только серверный рендер), аудит К3–К5.
 *
 * Строка: слева — дата и машинные строки (хэш/адрес моноширинно, укорочены
 * посередине, копирование, хэш → Tronscan), справа — сумма над статус-бейджем,
 * оба прижаты вправо. Цвет статуса — из единого словаря `STATUS_DICTIONARY`
 * (подпись — клиентская, из каталога). Отклонённая/отменённая сумма —
 * зачёркнута: видно, что денег не было.
 */

const VOID = new Set(['rejected', 'cancelled']);

async function loadTexts() {
  const t = await getTranslations('money');
  const tc = await getTranslations('common');
  const format = await getFormatter();
  const when = (d: Date) => format.dateTime(d, { dateStyle: 'short', timeStyle: 'short' });
  const status = (domain: 'deposit' | 'withdrawal', s: string) => {
    // У вывода («заявка») — свой род: «Отклонена», не «Отклонено».
    const own = `status.${domain}_${s}`;
    const label = t.has(own) ? t(own) : t.has(`status.${s}`) ? t(`status.${s}`) : s;
    const key = statusKeyOf(`${domain}_${s}`);
    return key ? <StatusBadge status={key} label={label} /> : <ToneBadge tone="neutral">{label}</ToneBadge>;
  };
  const copy = (what: string) => `${tc('copy')}: ${what}`;
  return { t, tc, when, status, copy };
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ left, amount, badge }: { left: React.ReactNode; amount: React.ReactNode; badge: React.ReactNode }) {
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">{left}</div>
      <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
        <span className="text-sm font-medium">{amount}</span>
        {badge}
      </div>
    </li>
  );
}

export async function DepositHistory({ items }: { items: DepositView[] }) {
  const { t, tc, when, status, copy } = await loadTexts();
  return (
    <Shell title={t('historyDeposits')}>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-border bg-elevated">
          <EmptyState size="compact" title={t('historyEmptyDeposits')} description={t('historyEmptyDepositsHint')} />
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-elevated">
          {items.map((d) => (
            <Row
              key={d.id}
              left={
                <>
                  <span className="text-xs tabular-nums text-secondary">{when(d.claimedAt)}</span>
                  <MachineValue
                    value={d.txHash}
                    label={t('txLabel')}
                    copyLabel={copy(t('copyHash'))}
                    copiedLabel={tc('copied')}
                    tronscanLabel={t('openTronscan')}
                    tx
                  />
                  {d.status === 'rejected' && d.rejectReason && t.has(`rejectReason.${d.rejectReason}`) ? (
                    <span className="text-xs text-negative">{t(`rejectReason.${d.rejectReason}`)}</span>
                  ) : null}
                </>
              }
              amount={
                <Money
                  minor={d.amountMinor}
                  currency="USDT"
                  className={cn(VOID.has(d.status) && 'text-muted line-through')}
                />
              }
              badge={status('deposit', d.status)}
            />
          ))}
        </ul>
      )}
    </Shell>
  );
}

export async function WithdrawalHistory({ items }: { items: WithdrawalView[] }) {
  const { t, tc, when, status, copy } = await loadTexts();
  return (
    <Shell title={t('historyWithdrawals')}>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-border bg-elevated">
          <EmptyState
            size="compact"
            title={t('historyEmptyWithdrawals')}
            description={t('historyEmptyWithdrawalsHint')}
          />
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-elevated">
          {items.map((w) => (
            <Row
              key={w.id}
              left={
                <>
                  <span className="text-xs tabular-nums text-secondary">{when(w.requestedAt)}</span>
                  <MachineValue
                    value={w.toAddress}
                    label={t('toLabel')}
                    copyLabel={copy(t('copyAddressLabel'))}
                    copiedLabel={tc('copied')}
                  />
                  {w.payoutTxHash ? (
                    <MachineValue
                      value={w.payoutTxHash}
                      label={t('payoutLabel')}
                      copyLabel={copy(t('copyHash'))}
                      copiedLabel={tc('copied')}
                      tronscanLabel={t('openTronscan')}
                      tx
                    />
                  ) : null}
                  {w.status === 'rejected' && w.rejectReason && t.has(`errors.terminal_${w.rejectReason}`) ? (
                    <span className="text-xs text-negative">{t(`errors.terminal_${w.rejectReason}`)}</span>
                  ) : null}
                </>
              }
              amount={
                <Money
                  minor={w.amountMinor}
                  currency="USDT"
                  className={cn(VOID.has(w.status) && 'text-muted line-through')}
                />
              }
              badge={status('withdrawal', w.status)}
            />
          ))}
        </ul>
      )}
    </Shell>
  );
}
