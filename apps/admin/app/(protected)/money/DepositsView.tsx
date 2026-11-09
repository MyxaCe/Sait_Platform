import Link from 'next/link';
import {
  DataTable,
  EmptyState,
  Panel,
  StatusBadge,
  ToneBadge,
  statusKeyOf,
  type DataTableColumn,
} from '@broker/ui';
import type { DepositRowView } from '@/lib/crypto/queries';
import { DEPOSIT_REJECT, DEPOSIT_STATUS } from '@/lib/crypto/labels';
import { fmtAge, fmtDateTime } from '@/lib/ui/format';
import { ChainAmount } from '../_money/amount';
import { Segmented } from '../_money/Segmented';
import { TronRef } from '../_money/tron';
import { DEPOSIT_STUCK_MINUTES, asDepositFilter, filterDeposits, hoursSince, moneyHref } from './view';

/**
 * Вкладка «Депозиты»: заявки клиентов «я отправил, вот хэш». Проверку в сети
 * и зачисление делает наблюдатель — у оператора здесь действий нет, это
 * реестр для сверки (хэш и отправитель — со ссылкой в Tronscan).
 */

const stuck = (d: DepositRowView) =>
  d.status === 'claimed' && hoursSince(d.claimedAt) * 60 > DEPOSIT_STUCK_MINUTES;

const COLUMNS: DataTableColumn<DepositRowView>[] = [
  {
    key: 'client',
    header: 'Клиент',
    cell: (d) =>
      d.userId ? (
        <Link href={`/clients/${d.userId}?tab=money`} className="group block min-w-0">
          <span className="text-primary group-hover:text-accent block truncate font-medium">{d.clientName}</span>
          <span className="text-muted block truncate text-xs">{d.clientEmail}</span>
        </Link>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  {
    key: 'amount',
    header: 'Сумма, USDT',
    numeric: true,
    width: '9rem',
    cell: (d) => (
      <ChainAmount
        amountMinor={d.amountMinor}
        amountRaw={d.amountRaw}
        dustRaw={d.dustRaw}
        hideCurrency
        struck={d.status === 'rejected'}
        className={d.status === 'credited' ? 'font-medium' : undefined}
      />
    ),
  },
  {
    key: 'status',
    header: 'Статус',
    width: '11rem',
    cell: (d) => {
      const key = statusKeyOf(`deposit_${d.status}`);
      return (
        <span className="inline-flex flex-col items-start gap-0.5">
          {key ? <StatusBadge status={key} /> : <ToneBadge tone="neutral">{DEPOSIT_STATUS[d.status] ?? d.status}</ToneBadge>}
          {d.rejectReason ? (
            <span className="text-negative text-xs">{DEPOSIT_REJECT[d.rejectReason] ?? d.rejectReason}</span>
          ) : d.status === 'claimed' ? (
            <span className={stuck(d) ? 'text-warning text-xs font-medium' : 'text-muted text-xs'}>
              ждёт {fmtAge(d.claimedAt)}
            </span>
          ) : null}
          {d.status === 'claimed' && d.checkNote ? <span className="text-muted text-xs">{d.checkNote}</span> : null}
        </span>
      );
    },
  },
  {
    key: 'hash',
    header: 'Хэш транзакции',
    width: '13rem',
    cell: (d) => <TronRef kind="tx" value={d.txHash} middle={6} />,
  },
  {
    key: 'from',
    header: 'Отправитель',
    width: '12rem',
    cell: (d) => (d.fromAddress ? <TronRef kind="address" value={d.fromAddress} middle={5} /> : <span className="text-muted">—</span>),
  },
  {
    key: 'at',
    header: 'Заявлен',
    numeric: true,
    width: '9rem',
    cell: (d) => (
      <span className="inline-flex flex-col items-end">
        <span>{fmtDateTime(d.claimedAt)}</span>
        {d.creditedAt ? <span className="text-muted text-xs">зачислен {fmtDateTime(d.creditedAt)}</span> : null}
      </span>
    ),
  },
];

const FILTER_LABEL: Record<string, string> = {
  claimed: 'Ждут сети',
  credited: 'Зачислены',
  rejected: 'Отклонены',
};

export function DepositsView({ rows, filterParam }: { rows: DepositRowView[]; filterParam: string | undefined }) {
  const filter = asDepositFilter(filterParam);
  const shown = filterDeposits(rows, filter);
  const count = (s: string) => rows.filter((d) => d.status === s).length;

  return (
    <Panel
      title="Депозиты"
      count={shown.length}
      description={`Клиент заявил хэш — наблюдатель проверяет транзакцию в сети и зачисляет сам. Ждёт сети дольше ${DEPOSIT_STUCK_MINUTES} мин — подсвечено.`}
      flush
    >
      <DataTable
        bare
        aria-label="Депозиты USDT"
        toolbar={
          <Segmented
            label="Фильтр депозитов"
            active={filter}
            items={[
              { key: 'all', label: 'Все', href: moneyHref({ tab: 'deposits' }), count: rows.length },
              { key: 'claimed', label: FILTER_LABEL.claimed!, href: moneyHref({ tab: 'deposits', ds: 'claimed' }), count: count('claimed') },
              { key: 'credited', label: FILTER_LABEL.credited!, href: moneyHref({ tab: 'deposits', ds: 'credited' }), count: count('credited') },
              { key: 'rejected', label: FILTER_LABEL.rejected!, href: moneyHref({ tab: 'deposits', ds: 'rejected' }), count: count('rejected') },
            ]}
          />
        }
        columns={COLUMNS}
        rows={shown}
        rowKey={(d) => d.id}
        rowTone={(d) => (stuck(d) ? 'warning' : undefined)}
        empty={
          filter === 'all' ? (
            <EmptyState
              size="compact"
              title="Депозитов ещё не было"
              description="Когда клиент отправит USDT и заявит хэш в кабинете, заявка появится здесь."
            />
          ) : (
            <EmptyState
              size="compact"
              title={`Нет депозитов в статусе «${FILTER_LABEL[filter]}»`}
              action={
                <Link href={moneyHref({ tab: 'deposits' })} className="text-accent text-[13px] font-medium hover:underline">
                  Сбросить фильтр
                </Link>
              }
            />
          )
        }
      />
    </Panel>
  );
}
