import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Callout,
  DataTable,
  DescriptionList,
  EmptyState,
  Panel,
  StatusBadge,
  type DataTableColumn,
} from '@broker/ui';
import type { DepositRowView } from '@/lib/crypto/queries';
import { fmtAge, fmtDateTime } from '@/lib/ui/format';
import { ChainAmount, chainCents } from '../_money/amount';
import { DecisionArea } from '../_money/ActionForm';
import { TronRef } from '../_money/tron';
import { BindForm } from './MoneyForms';
import { moneyHref } from './view';

/**
 * Вкладка «Неопознанные»: входящие USDT на кошелёк биржи, на которые никто не
 * заявил хэш. Слева список, справа — привязка выбранного (`?u=<id>`) к
 * клиенту с основанием (зачисление на реальный счёт, журнал).
 */

function columns(selectedId: string | undefined): DataTableColumn<DepositRowView>[] {
  return [
    {
      key: 'amount',
      header: 'Сумма, USDT',
      numeric: true,
      width: '9rem',
      cell: (d) => (
        <ChainAmount amountMinor={d.amountMinor} amountRaw={d.amountRaw} dustRaw={d.dustRaw} hideCurrency className="font-medium" />
      ),
    },
    {
      key: 'from',
      header: 'Отправитель',
      cell: (d) => (d.fromAddress ? <TronRef kind="address" value={d.fromAddress} middle={5} /> : <span className="text-muted">—</span>),
    },
    { key: 'hash', header: 'Хэш транзакции', cell: (d) => <TronRef kind="tx" value={d.txHash} middle={5} /> },
    {
      key: 'at',
      header: 'В сети',
      numeric: true,
      width: '9rem',
      cell: (d) =>
        d.blockTime ? (
          <span className="inline-flex flex-col items-end">
            <span className="text-secondary text-xs">{fmtDateTime(d.blockTime)}</span>
            <span>{fmtAge(d.blockTime)}</span>
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'go',
      header: <span className="sr-only">Действие</span>,
      width: '6.5rem',
      align: 'right',
      cell: (d) =>
        d.id === selectedId ? (
          <span className="text-secondary text-[13px]">Открыто</span>
        ) : (
          <Link
            href={moneyHref({ tab: 'unidentified', u: d.id, anchor: 'bind' })}
            scroll={false}
            className="text-accent text-[13px] font-medium hover:underline"
          >
            Привязать
          </Link>
        ),
    },
  ];
}

function BindPanel({ d }: { d: DepositRowView }) {
  const bound = d.status !== 'unidentified';
  return (
    <Panel
      id="bind"
      title="Неопознанное поступление"
      actions={<StatusBadge status={bound ? 'deposit_credited' : 'deposit_unidentified'} label={bound ? 'Привязано' : undefined} />}
      className="scroll-mt-20"
    >
      <div className="space-y-5">
        <div>
          <p className="text-muted text-xs">Пришло на кошелёк биржи</p>
          <div className="text-primary text-2xl font-semibold tracking-tight">
            <ChainAmount amountMinor={d.amountMinor} amountRaw={d.amountRaw} dustRaw={d.dustRaw} />
          </div>
        </div>
        <DescriptionList
          columns={1}
          items={[
            {
              term: 'Отправитель (TRON)',
              value: d.fromAddress ? <TronRef kind="address" value={d.fromAddress} full className="text-[13px]" /> : '—',
            },
            { term: 'Хэш транзакции', value: <TronRef kind="tx" value={d.txHash} full className="text-[13px]" /> },
            {
              term: 'В сети',
              value: d.blockTime ? fmtDateTime(d.blockTime) : '—',
              numeric: true,
              hint: d.blockTime ? `${fmtAge(d.blockTime)} назад` : undefined,
            },
          ]}
        />
        <DecisionArea>
          {bound ? (
            <Callout tone="positive" title="Поступление привязано">
              Зачислено на реальный счёт клиента
              {d.userId ? (
                <>
                  {' '}
                  <Link href={`/clients/${d.userId}?tab=money`} className="text-accent hover:underline">
                    {d.clientName ?? 'клиента'}
                  </Link>
                </>
              ) : null}
              .
            </Callout>
          ) : (
            <>
              <Callout tone="warning" title="Чей это платёж?">
                Клиент не заявил хэш этой транзакции. Привязывайте, только если знаете отправителя:
                клиент прислал хэш или адрес в поддержку. Сверьте адрес отправителя в Tronscan с
                прежними депозитами клиента.
              </Callout>
              <BindForm depositId={d.id} amountMinor={chainCents(d.amountMinor, d.amountRaw)} fromAddress={d.fromAddress} />
            </>
          )}
        </DecisionArea>
      </div>
    </Panel>
  );
}

export function UnidentifiedView({
  rows,
  identified,
  selectedId,
}: {
  rows: DepositRowView[];
  /** Прочие депозиты: только что привязанное ищется здесь, чтобы панель не пропала. */
  identified: DepositRowView[];
  selectedId: string | undefined;
}) {
  // Как и в выводах: выбранное поступление закрепляется в URL.
  if (!selectedId && rows[0]) redirect(moneyHref({ tab: 'unidentified', u: rows[0].id }));
  const selected = rows.find((d) => d.id === selectedId) ?? identified.find((d) => d.id === selectedId);

  const table = (
    <Panel
      title="Неопознанные поступления"
      count={rows.length}
      description="Входящие USDT на кошелёк биржи без заявленного хэша. Новые сверху."
      flush
    >
      <DataTable
        bare
        aria-label="Неопознанные поступления"
        columns={columns(selected?.id)}
        rows={rows}
        rowKey={(d) => d.id}
        selectedKey={selected?.id}
        rowTone={() => 'warning'}
        empty={
          <EmptyState
            size="compact"
            title="Неопознанных поступлений нет"
            description="На каждый входящий USDT клиент заявил хэш — привязывать нечего."
          />
        }
      />
    </Panel>
  );

  if (!selected) return table;
  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="min-w-0">{table}</div>
      <aside
        aria-label="Привязка поступления"
        className="min-w-0"
      >
        <BindPanel key={selected.id} d={selected} />
      </aside>
    </div>
  );
}
