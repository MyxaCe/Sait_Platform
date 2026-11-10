import { getFormatter, getTranslations } from 'next-intl/server';
import { EmptyState, Money, StatusBadge, ToneBadge, cn, statusKeyOf } from '@broker/ui';
import type { DepositView, WithdrawalView } from '@/lib/money';
import { NavIcon } from '@/features/shell/NavIcon';
import { MachineValue } from './TxLink';

/**
 * Денежные операции реального счёта (ввод/вывод USDT) — ОДНА лента (r2:
 * «Кошелёк» и «История» показывают её одинаково).
 *
 * Строка: слева — тип (иконка + «Пополнение»/«Вывод»), дата и машинные строки
 * (хэш/адрес моноширинно, укорочены посередине, копирование, хэш → Tronscan);
 * справа — сумма со знаком направления над статус-бейджем. Цвет статуса — из
 * единого словаря `STATUS_DICTIONARY` (подпись клиентская, из каталога).
 * Отклонённая/отменённая сумма зачёркнута: денег не было.
 */

export type MoneyOp =
  | { kind: 'deposit'; at: Date; item: DepositView }
  | { kind: 'withdrawal'; at: Date; item: WithdrawalView };

/** Ввод и вывод — в одну ленту, новые сверху. */
export function toMoneyOps(deposits: DepositView[], withdrawals: WithdrawalView[]): MoneyOp[] {
  return [
    ...deposits.map((d) => ({ kind: 'deposit' as const, at: d.claimedAt, item: d })),
    ...withdrawals.map((w) => ({ kind: 'withdrawal' as const, at: w.requestedAt, item: w })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
}

const VOID = new Set(['rejected', 'cancelled']);

/** Готовит отрисовщик строки операции (тексты и форматтер — один раз на список). */
export async function moneyOpRenderer() {
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

  return function render(op: MoneyOp) {
    const isDep = op.kind === 'deposit';
    const st = op.item.status;
    const minor = op.item.amountMinor;
    return (
      <li key={`${op.kind}-${op.item.id}`} className="flex items-start gap-3 px-4 py-3" data-op={op.kind}>
        <span
          aria-hidden
          className={cn(
            'mt-0.5 grid size-8 shrink-0 place-items-center rounded-full',
            isDep ? 'bg-positive/10 text-positive' : 'bg-primary/[0.06] text-secondary',
          )}
        >
          <NavIcon name={isDep ? 'deposit' : 'withdraw'} className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium">{t(isDep ? 'opDeposit' : 'opWithdrawal')}</span>
          <span className="text-xs tabular-nums text-secondary">{when(op.at)}</span>
          {op.kind === 'deposit' ? (
            <>
              <MachineValue
                value={op.item.txHash}
                label={t('txLabel')}
                copyLabel={copy(t('copyHash'))}
                copiedLabel={tc('copied')}
                tronscanLabel={t('openTronscan')}
                tx
              />
              {st === 'rejected' && op.item.rejectReason && t.has(`rejectReason.${op.item.rejectReason}`) ? (
                <span className="text-xs text-negative">{t(`rejectReason.${op.item.rejectReason}`)}</span>
              ) : null}
            </>
          ) : (
            <>
              <MachineValue
                value={op.item.toAddress}
                label={t('toLabel')}
                copyLabel={copy(t('copyAddressLabel'))}
                copiedLabel={tc('copied')}
              />
              {op.item.payoutTxHash ? (
                <MachineValue
                  value={op.item.payoutTxHash}
                  label={t('payoutLabel')}
                  copyLabel={copy(t('copyHash'))}
                  copiedLabel={tc('copied')}
                  tronscanLabel={t('openTronscan')}
                  tx
                />
              ) : null}
              {st === 'rejected' && op.item.rejectReason && t.has(`errors.terminal_${op.item.rejectReason}`) ? (
                <span className="text-xs text-negative">{t(`errors.terminal_${op.item.rejectReason}`)}</span>
              ) : null}
            </>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
          <span className="text-sm font-medium">
            <Money
              minor={minor === null ? null : isDep ? minor : -minor}
              currency="USDT"
              signed
              className={cn(VOID.has(st) && 'text-muted line-through')}
            />
          </span>
          {status(isDep ? 'deposit' : 'withdrawal', st)}
        </div>
      </li>
    );
  };
}

/** «История операций» кошелька: ввод и вывод вместе. */
export async function OperationsHistory({
  deposits,
  withdrawals,
}: {
  deposits: DepositView[];
  withdrawals: WithdrawalView[];
}) {
  const t = await getTranslations('money');
  const render = await moneyOpRenderer();
  const ops = toMoneyOps(deposits, withdrawals);
  return (
    <section className="space-y-2" aria-labelledby="ops-title">
      <h2 id="ops-title" className="text-sm font-semibold">
        {t('historyOperations')}
      </h2>
      {ops.length === 0 ? (
        <div className="rounded-2xl border border-border bg-elevated">
          <EmptyState size="compact" title={t('historyEmptyOps')} description={t('historyEmptyOpsHint')} />
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-elevated">{ops.map(render)}</ul>
      )}
    </section>
  );
}
