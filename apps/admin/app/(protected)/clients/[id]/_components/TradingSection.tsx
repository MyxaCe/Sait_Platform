import {
  Callout,
  DataTable,
  EmptyState,
  Money,
  Panel,
  ToneBadge,
  type DataTableColumn,
} from '@broker/ui';
import {
  RECENT_TRADES_LIMIT,
  type ClientTrading,
  type TradingPosition,
  type TradingTrade,
} from '@/lib/clients/trading';
import { fmtDate, fmtDateTime } from '@/lib/ui/format';

/**
 * Счёт и торговля клиента (вкладка «Торговля» и сводка на «Обзоре»). Только
 * чтение проекции торговли (`lib/clients/trading.ts`) + живые цифры терминала
 * (`GET …/accounts`), если он ответил. Equity из проекции не считаем — текущих
 * цен в ней нет, выдумывать их нельзя: equity/маржа — только от терминала.
 */

function num(value: number, max = 8): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: max });
}

const SIDE: Record<'buy' | 'sell', string> = { buy: 'Покупка', sell: 'Продажа' };

function SideCell({ side }: { side: 'buy' | 'sell' }) {
  return (
    <span className={side === 'buy' ? 'text-positive' : 'text-negative'}>
      {side === 'buy' ? '▲' : '▼'} {SIDE[side]}
    </span>
  );
}

const POSITION_COLUMNS: DataTableColumn<TradingPosition>[] = [
  { key: 'symbol', header: 'Инструмент', cell: (p) => <span className="font-medium">{p.symbol}</span> },
  { key: 'side', header: 'Сторона', width: '8rem', cell: (p) => <SideCell side={p.side} /> },
  { key: 'volume', header: 'Объём', numeric: true, width: '8rem', cell: (p) => num(p.volume) },
  { key: 'entry', header: 'Цена входа', numeric: true, width: '9rem', cell: (p) => num(p.entryPrice) },
  { key: 'updated', header: 'Снимок', numeric: true, width: '10rem', cell: (p) => fmtDateTime(p.updatedAt) },
];

function tradeColumns(currency: string): DataTableColumn<TradingTrade>[] {
  return [
    { key: 'when', header: 'Время', width: '10rem', numeric: true, align: 'left', cell: (t) => fmtDateTime(t.executedAt) },
    { key: 'symbol', header: 'Инструмент', cell: (t) => <span className="font-medium">{t.symbol}</span> },
    { key: 'side', header: 'Сторона', width: '8rem', cell: (t) => <SideCell side={t.side} /> },
    { key: 'volume', header: 'Объём', numeric: true, width: '7rem', cell: (t) => num(t.volume) },
    { key: 'price', header: 'Цена', numeric: true, width: '8rem', cell: (t) => num(t.price) },
    {
      key: 'pnl',
      header: `P&L, ${currency}`,
      numeric: true,
      width: '9rem',
      cell: (t) => <Money minor={t.realizedPnlCents} currency={currency} signed tone="auto" hideCurrency />,
    },
  ];
}

/** Живые цифры счёта из терминала (`GET …/accounts`); null — терминал не ответил. */
export interface LiveAccount {
  equityMinor: number | null;
  freeMarginMinor: number | null;
  tradingFrozen: boolean;
  opened: boolean;
}

function Stat({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 truncate text-lg font-semibold tabular-nums tracking-tight text-primary">{children}</p>
      {hint ? <p className="truncate text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** Строка ключевых цифр счёта: баланс / equity / свободная маржа / P&L. */
export function AccountStats({
  trading,
  kind,
  live,
}: {
  trading: ClientTrading;
  kind: 'demo' | 'real';
  live: LiveAccount | null | undefined;
}) {
  const currency = trading.account?.currency ?? (kind === 'real' ? 'USDT' : 'USD');
  const liveOk = live != null && live.opened;
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
      <Stat
        label="Баланс"
        hint={trading.account ? `открыт ${fmtDate(trading.account.openedAt)}` : kind === 'real' ? 'зачислений не было' : 'счёт не открыт'}
      >
        <Money minor={trading.account?.balanceCents ?? null} currency={currency} />
      </Stat>
      <Stat label="Equity" hint={liveOk ? 'терминал, сейчас' : 'терминал недоступен'}>
        <Money minor={liveOk ? live.equityMinor : null} currency={currency} />
      </Stat>
      <Stat label="Свободная маржа" hint={liveOk ? 'терминал, сейчас' : 'терминал недоступен'}>
        <Money minor={liveOk ? live.freeMarginMinor : null} currency={currency} />
      </Stat>
      <Stat label="Реализованный P&L" hint={`сделок всего: ${trading.tradesTotal}`}>
        <Money minor={trading.realizedPnlTotalCents} currency={currency} signed tone="auto" />
      </Stat>
    </div>
  );
}

export function TradingSection({
  trading,
  title,
  kind,
  live,
}: {
  trading: ClientTrading;
  title: string;
  kind: 'demo' | 'real';
  /** undefined — не запрашивали; null — терминал не ответил. */
  live?: LiveAccount | null;
}) {
  const currency = trading.account?.currency ?? (kind === 'real' ? 'USDT' : 'USD');

  return (
    <div className="space-y-4">
      <Panel
        title={
          <>
            {title}
            <ToneBadge tone={kind === 'real' ? 'info' : 'neutral'} plain>
              {kind === 'real' ? 'реальные деньги' : 'демо'}
            </ToneBadge>
            {live?.tradingFrozen ? <ToneBadge tone="negative">Торговля заморожена</ToneBadge> : null}
          </>
        }
        description={
          trading.lastActivityAt ? `Последняя торговая активность: ${fmtDateTime(trading.lastActivityAt)}` : 'Клиент на этом счёте не торговал'
        }
      >
        {live === null ? (
          <Callout tone="neutral" className="mb-4">
            Терминал не ответил — equity и свободная маржа сейчас недоступны. Баланс и сделки — из проекции событий.
          </Callout>
        ) : null}
        <AccountStats trading={trading} kind={kind} live={live} />
      </Panel>

      <Panel title="Открытые позиции" count={trading.positions.length} description="По снимку проекции; цена входа, без текущей оценки" flush>
        <DataTable
          bare
          aria-label={`Открытые позиции — ${title}`}
          columns={POSITION_COLUMNS}
          rows={trading.positions}
          rowKey={(p) => p.id}
          empty={<EmptyState size="compact" title="Открытых позиций нет" />}
        />
      </Panel>

      <Panel
        title="Последние сделки"
        count={trading.tradesTotal}
        description={
          trading.tradesTotal > RECENT_TRADES_LIMIT ? `Показаны последние ${RECENT_TRADES_LIMIT} из ${trading.tradesTotal}` : undefined
        }
        flush
        footer="Источник — проекция событий терминала (только чтение)."
      >
        <DataTable
          bare
          aria-label={`Последние сделки — ${title}`}
          columns={tradeColumns(currency)}
          rows={trading.recentTrades}
          rowKey={(t) => t.id}
          empty={<EmptyState size="compact" title="Сделок пока не было" />}
        />
      </Panel>
    </div>
  );
}
