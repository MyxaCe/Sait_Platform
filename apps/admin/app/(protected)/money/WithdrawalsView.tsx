import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Callout,
  CopyButton,
  DataTable,
  DescriptionList,
  EmptyState,
  Mono,
  Money,
  Panel,
  StatusBadge,
  ToneBadge,
  statusKeyOf,
  type DataTableColumn,
  type DescriptionItem,
} from '@broker/ui';
import type { WithdrawalRowView } from '@/lib/crypto/queries';
import { DEBIT_STATE } from '@/lib/crypto/labels';
import { fmtAge, fmtDateTime } from '@/lib/ui/format';
import { DecisionArea } from '../_money/ActionForm';
import { Segmented } from '../_money/Segmented';
import { TronRef } from '../_money/tron';
import { WithdrawalActions } from './MoneyForms';
import {
  WITHDRAWAL_SLA_HOURS,
  asWithdrawalFilter,
  awaitsOperator,
  hoursSince,
  isOpenWithdrawal,
  moneyHref,
  orderWithdrawals,
  type WithdrawalFilter,
} from './view';

/**
 * Вкладка «Выводы» (концепция §7.4): слева очередь (старейшее и срочное
 * сверху), справа — панель решения выбранной заявки (`?w=<id>`): детали,
 * следующий шаг и формы-с-основанием только из допустимых переходов.
 */

function WithdrawalStatus({ status }: { status: string }) {
  const key = statusKeyOf(`withdrawal_${status}`);
  return key ? <StatusBadge status={key} /> : <ToneBadge tone="neutral">{status}</ToneBadge>;
}

const isVoid = (status: string) => status === 'rejected' || status === 'cancelled';
const overdue = (w: WithdrawalRowView) =>
  w.status === 'requested' && hoursSince(w.requestedAt) > WITHDRAWAL_SLA_HOURS;

function columns(filter: WithdrawalFilter, selectedId: string | undefined): DataTableColumn<WithdrawalRowView>[] {
  return [
    {
      key: 'client',
      header: 'Клиент',
      cell: (w) => (
        <Link href={`/clients/${w.userId}?tab=money`} className="group block min-w-0">
          <span className="text-primary group-hover:text-accent block truncate font-medium">{w.clientName}</span>
          <span className="text-muted block truncate text-xs">{w.clientEmail}</span>
        </Link>
      ),
    },
    {
      key: 'amount',
      header: 'Сумма, USDT',
      numeric: true,
      width: '9rem',
      cell: (w) => (
        <Money
          minor={w.amountMinor}
          currency="USDT"
          hideCurrency
          className={isVoid(w.status) ? 'text-muted line-through' : 'font-medium'}
        />
      ),
    },
    { key: 'status', header: 'Статус', width: '8.5rem', cell: (w) => <WithdrawalStatus status={w.status} /> },
    {
      key: 'age',
      header: 'Подана',
      numeric: true,
      width: '9rem',
      cell: (w) => (
        <span className="inline-flex flex-col items-end">
          <span className="text-secondary text-xs">{fmtDateTime(w.requestedAt)}</span>
          {isOpenWithdrawal(w.status) ? (
            <span className={overdue(w) ? 'text-warning font-medium' : 'text-primary'}>
              {fmtAge(w.requestedAt)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'go',
      header: <span className="sr-only">Действие</span>,
      width: '7.5rem',
      align: 'right',
      cell: (w) =>
        w.id === selectedId ? (
          <span className="text-secondary text-[13px]">Открыта</span>
        ) : (
          <Link
            href={moneyHref({ tab: 'withdrawals', f: filter, w: w.id, anchor: 'decision' })}
            scroll={false}
            className="text-accent whitespace-nowrap text-[13px] font-medium hover:underline"
          >
            {awaitsOperator(w.status) ? 'Решить' : w.status === 'approved' ? 'Внести хэш' : 'Открыть'}
          </Link>
        ),
    },
  ];
}

const NEXT_STEP: Record<string, { tone: 'info' | 'warning' | 'neutral' | 'positive' | 'negative'; title: string; text: string }> = {
  requested: {
    tone: 'warning',
    title: 'Ждёт вашего решения',
    text: 'Одобрение деньги не отправляет; отклонение вернёт сумму на счёт клиента.',
  },
  approved: {
    tone: 'info',
    title: 'Одобрена — отправьте USDT',
    text: 'Отправьте ровно эту сумму с кошелька биржи на адрес получателя и внесите хэш транзакции ниже.',
  },
  sent: {
    tone: 'info',
    title: 'Отправлена — сверка в сети',
    text: 'Наблюдатель сверяет получателя и сумму транзакции. Действий не требуется.',
  },
  needs_review: {
    tone: 'warning',
    title: 'Сверка не сошлась — решает человек',
    text: 'Автоматического возврата нет. Откройте хэш отправки в Tronscan и решите: исполнена или отмена с возвратом.',
  },
  settled: { tone: 'positive', title: 'Исполнена', text: 'Клиент получил USDT. Заявка закрыта.' },
  rejected: { tone: 'neutral', title: 'Отклонена', text: 'Заявка закрыта без выплаты.' },
  cancelled: { tone: 'neutral', title: 'Отменена', text: 'Заявка закрыта без выплаты.' },
};

/** Где деньги закрытой без выплаты заявки — по факту возврата/списания, а не по статусу. */
function voidMoneyNote(w: WithdrawalRowView): string {
  if (w.refunded) return ' Сумма возвращена на реальный счёт клиента.';
  if (w.debitState === 'refused') return ' Списания не было (терминал отказал) — деньги остались на счёте клиента.';
  return ' Отметки о возврате нет — сверьте с журналом.';
}

const AMOUNT_LABEL: Record<string, string> = {
  settled: 'Выплачено',
  rejected: 'Сумма заявки',
  cancelled: 'Сумма заявки',
};

function DecisionPanel({ w }: { w: WithdrawalRowView }) {
  const step = NEXT_STEP[w.status];
  const debitTone: DescriptionItem['tone'] = w.debitState === 'pending' ? 'warning' : 'default';
  const items: DescriptionItem[] = [
    {
      term: 'Клиент',
      value: (
        <Link href={`/clients/${w.userId}?tab=money`} className="text-primary hover:text-accent font-medium">
          {w.clientName}
        </Link>
      ),
      hint: w.clientEmail,
    },
    {
      term: 'Адрес получателя (TRON)',
      value: <TronRef kind="address" value={w.toAddress} full className="text-[13px]" />,
    },
    {
      term: 'Подана',
      value: fmtDateTime(w.requestedAt),
      numeric: true,
      hint: isOpenWithdrawal(w.status) ? `в очереди ${fmtAge(w.requestedAt)}` : undefined,
    },
    {
      term: 'Списание в терминале',
      value: DEBIT_STATE[w.debitState] ?? w.debitState,
      tone: debitTone,
      hint: w.refunded ? 'возвращено на счёт клиента' : undefined,
    },
  ];
  if (w.payoutTxHash) {
    items.push({
      term: 'Хэш отправки',
      value: <TronRef kind="tx" value={w.payoutTxHash} full className="text-[13px]" />,
    });
  }
  if (w.rejectReason) items.push({ term: 'Причина отказа', value: w.rejectReason, tone: 'negative' });
  if (w.reviewReason) items.push({ term: 'Расхождение', value: w.reviewReason, tone: 'warning' });
  if (w.checkNote) items.push({ term: 'Наблюдатель', value: w.checkNote });
  items.push({
    term: 'Заявка',
    value: (
      <span className="inline-flex items-center gap-1">
        <Mono value={w.id} middle={8} className="text-secondary" />
        <CopyButton value={w.id} label="id заявки" />
      </span>
    ),
  });

  return (
    <Panel
      id="decision"
      title="Заявка на вывод"
      actions={<WithdrawalStatus status={w.status} />}
      className="scroll-mt-20"
    >
      <div className="space-y-5">
        <div>
          <p className="text-muted text-xs">{AMOUNT_LABEL[w.status] ?? 'Сумма к выплате'}</p>
          <Money
            minor={w.amountMinor}
            currency="USDT"
            className={
              isVoid(w.status)
                ? 'text-muted text-2xl font-semibold tracking-tight line-through'
                : 'text-primary text-2xl font-semibold tracking-tight'
            }
          />
        </div>
        <DescriptionList columns={1} items={items} />
        {/* Итог решения живёт над шагом и формами, пока открыта эта заявка
            (панель перемонтируется только при выборе другой заявки). */}
        <DecisionArea>
          {step ? (
            <Callout tone={step.tone} title={step.title}>
              {step.text}
              {isVoid(w.status) ? voidMoneyNote(w) : null}
              {w.status === 'requested'
                ? w.debitState === 'pending'
                  ? ' Списание терминалом ещё не подтверждено — «Одобрить» сначала повторит его (безопасно).'
                  : ' Сумма уже списана со счёта клиента и зарезервирована.'
                : null}
            </Callout>
          ) : null}
          <WithdrawalActions
            w={{
              id: w.id,
              status: w.status,
              debitState: w.debitState,
              amountMinor: w.amountMinor,
              clientName: w.clientName,
              clientEmail: w.clientEmail,
              toAddress: w.toAddress,
            }}
          />
        </DecisionArea>
      </div>
    </Panel>
  );
}

export function WithdrawalsView({
  rows,
  filterParam,
  selectedId,
}: {
  rows: WithdrawalRowView[];
  filterParam: string | undefined;
  selectedId: string | undefined;
}) {
  const filter = asWithdrawalFilter(filterParam);
  const shown = orderWithdrawals(rows, filter);
  // Выбранная заявка — всегда в URL. Без `w` открываем самую срочную, но
  // закрепляем её в адресе: после решения порядок очереди меняется, и панель
  // не должна молча переключиться на заявку другого клиента.
  if (!selectedId && shown[0]) {
    redirect(moneyHref({ tab: 'withdrawals', f: filter, w: shown[0].id }));
  }
  const selected = rows.find((w) => w.id === selectedId);
  const openCount = rows.filter((w) => isOpenWithdrawal(w.status)).length;

  const table = (
    <Panel
      title="Заявки на вывод"
      count={shown.length}
      description={
        filter === 'closed'
          ? 'Исполненные, отклонённые и отменённые — новые сверху.'
          : `Сначала ждущие решения, внутри — старейшие. Подана дольше ${WITHDRAWAL_SLA_HOURS} ч — подсвечено.`
      }
      flush
    >
      <DataTable
        bare
        aria-label="Заявки на вывод"
        toolbar={
          <Segmented
            label="Фильтр заявок"
            active={filter}
            items={[
              { key: 'open', label: 'В работе', href: moneyHref({ tab: 'withdrawals', f: 'open' }), count: openCount },
              {
                key: 'closed',
                label: 'Завершённые',
                href: moneyHref({ tab: 'withdrawals', f: 'closed' }),
                count: rows.length - openCount,
              },
              { key: 'all', label: 'Все', href: moneyHref({ tab: 'withdrawals', f: 'all' }), count: rows.length },
            ]}
          />
        }
        columns={columns(filter, selected?.id)}
        rows={shown}
        rowKey={(w) => w.id}
        selectedKey={selected?.id}
        rowTone={(w) => (w.status === 'needs_review' || overdue(w) ? 'warning' : undefined)}
        empty={
          filter === 'open' ? (
            <EmptyState
              size="compact"
              title="Очередь выводов пуста"
              description="Заявок, ждущих решения, отправки или сверки, нет."
              action={
                rows.length > 0 ? (
                  <Link href={moneyHref({ tab: 'withdrawals', f: 'closed' })} className="text-accent text-[13px] font-medium hover:underline">
                    Завершённые заявки →
                  </Link>
                ) : undefined
              }
            />
          ) : filter === 'closed' ? (
            <EmptyState size="compact" title="Завершённых заявок нет" description="Ни одна заявка ещё не исполнена, не отклонена и не отменена." />
          ) : (
            <EmptyState size="compact" title="Заявок на вывод ещё не было" description="Клиенты подают их из кабинета; здесь они появятся сразу." />
          )
        }
      />
    </Panel>
  );

  if (!selected) return table;

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="min-w-0">{table}</div>
      <aside
        aria-label="Решение по заявке"
        className="min-w-0"
      >
        <DecisionPanel key={selected.id} w={selected} />
      </aside>
    </div>
  );
}
