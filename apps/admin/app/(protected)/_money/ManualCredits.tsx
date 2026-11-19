import Link from 'next/link';
import { DataTable, EmptyState, Money, ToneBadge, type DataTableColumn, type StatusTone } from '@broker/ui';
import type { ManualCreditRow } from '@/lib/money/credit-queries';
import { fmtDateTime } from '@/lib/ui/format';
import { ApproveCreditForm, DeclineCreditForm, RetryCreditForm, type CreditFacts } from './ManualCreditForms';

export function creditStateView(r: Pick<ManualCreditRow, 'state' | 'resultCode'>): { tone: StatusTone; label: string } {
  switch (r.state) {
    case 'executed':
      return { tone: 'positive', label: 'Зачислено' };
    case 'awaiting_second_approval':
      return { tone: 'warning', label: 'Ждёт подтверждения' };
    case 'dispatched':
      return { tone: 'warning', label: 'Терминал не ответил' };
    case 'rejected':
      return r.resultCode === 'declined'
        ? { tone: 'negative', label: 'Отклонено оператором' }
        : { tone: 'negative', label: 'Терминал отказал' };
    case 'signed':
      return { tone: 'info', label: 'Подписана' };
    default:
      return { tone: 'neutral', label: 'Черновик' };
  }
}

export const needsRetry = (r: ManualCreditRow) => r.state === 'dispatched' || r.state === 'signed';

export function creditFacts(r: ManualCreditRow): CreditFacts {
  return {
    commandId: r.id,
    userId: r.userId,
    clientName: r.clientName ?? 'Без имени',
    clientEmail: r.clientEmail ?? r.userId,
    amountMinor: r.amountMinor,
    basis: r.basis,
    initiatorName: r.initiatorName ?? r.initiatorId,
  };
}

function outcomeText(r: ManualCreditRow): string | null {
  if (r.state === 'executed') return r.terminalSeq !== null ? `проводка терминала №${r.terminalSeq}` : 'проведено терминалом';
  if (r.state === 'rejected' && r.resultCode === 'declined') {
    return `${r.deciderName ?? 'оператор'}: ${r.resultDetail ?? 'без причины'}`;
  }
  if (r.state === 'rejected') return `код терминала: ${r.resultCode ?? '—'}`;
  if (r.state === 'dispatched') return `попыток: ${r.attempts}, можно повторить`;
  return null;
}

function columns(withClient: boolean): DataTableColumn<ManualCreditRow>[] {
  return [
    { key: 'at', header: 'Создана', width: '9.5rem', cell: (r) => <span className="tabular-nums text-secondary">{fmtDateTime(r.createdAt)}</span> },
    ...(withClient
      ? [
          {
            key: 'client',
            header: 'Клиент',
            cell: (r: ManualCreditRow) => (
              <Link href={`/clients/${r.userId}?tab=money`} className="group block min-w-0">
                <span className="text-primary group-hover:text-accent block truncate font-medium">{r.clientName ?? 'Без имени'}</span>
                <span className="text-muted block truncate text-xs">{r.clientEmail ?? r.userId}</span>
              </Link>
            ),
          },
        ]
      : []),
    { key: 'amount', header: 'Сумма', numeric: true, width: '9rem', cell: (r) => <Money minor={r.amountMinor} currency="USDT" /> },
    {
      key: 'state',
      header: 'Статус',
      width: '11rem',
      cell: (r) => {
        const v = creditStateView(r);
        return <ToneBadge tone={v.tone}>{v.label}</ToneBadge>;
      },
    },
    {
      key: 'who',
      header: 'Инициатор / подтвердил',
      width: '13rem',
      cell: (r) => (
        <span className="block min-w-0">
          <span className="block truncate">{r.initiatorName ?? r.initiatorId}</span>
          <span className="text-muted block truncate text-xs">
            {r.approverName
              ? `подтвердил: ${r.approverName}`
              : r.bootstrapMode && r.initiatorRole === 'admin' && r.state !== 'awaiting_second_approval'
                ? 'самоподтверждение (режим запуска)'
                : r.state === 'awaiting_second_approval'
                  ? 'ждёт второго оператора'
                  : '—'}
          </span>
        </span>
      ),
    },
    {
      key: 'basis',
      header: 'Основание и итог',
      cell: (r) => {
        const outcome = outcomeText(r);
        return (
          <span className="block min-w-0">
            <span className="block break-words">{r.basis}</span>
            {outcome ? <span className="text-muted block text-xs">{outcome}</span> : null}
          </span>
        );
      },
    },
  ];
}

export function ManualCreditsTable({ rows, withClient, label }: { rows: ManualCreditRow[]; withClient: boolean; label: string }) {
  return (
    <DataTable
      bare
      aria-label={label}
      columns={columns(withClient)}
      rows={rows}
      rowKey={(r) => r.id}
      rowTone={(r) => (r.state === 'dispatched' || r.state === 'awaiting_second_approval' ? 'warning' : r.state === 'rejected' ? 'negative' : undefined)}
      empty={<EmptyState size="compact" title="Ручных зачислений не было" />}
    />
  );
}

export function PendingCreditCard({ row, operatorId, canAct }: { row: ManualCreditRow; operatorId: string | null; canAct: boolean }) {
  const facts = creditFacts(row);
  const own = operatorId !== null && row.initiatorId === operatorId;
  const v = creditStateView(row);
  return (
    <article className="border-border space-y-4 rounded-md border p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-primary text-sm font-semibold">
            <Money minor={row.amountMinor} currency="USDT" className="text-base" /> →{' '}
            <Link href={`/clients/${row.userId}?tab=money`} className="text-accent hover:underline">
              {facts.clientName}
            </Link>
          </p>
          <p className="text-muted mt-0.5 text-xs">
            {facts.clientEmail} · создал {facts.initiatorName} · {fmtDateTime(row.createdAt)}
          </p>
          <p className="text-secondary mt-1.5 text-[13px]">Основание: {row.basis}</p>
        </div>
        <ToneBadge tone={v.tone}>{v.label}</ToneBadge>
      </header>
      {!canAct ? null : row.state === 'awaiting_second_approval' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {own ? (
            <p className="text-muted text-[13px]">
              Это ваша команда: подтвердить её должен другой оператор с правом на деньги. Отклонить (отозвать) можно.
            </p>
          ) : (
            <ApproveCreditForm c={facts} />
          )}
          <DeclineCreditForm c={facts} />
        </div>
      ) : needsRetry(row) ? (
        <RetryCreditForm c={facts} />
      ) : null}
    </article>
  );
}
