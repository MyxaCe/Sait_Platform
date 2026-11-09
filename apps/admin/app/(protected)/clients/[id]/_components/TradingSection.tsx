import { DataTable, KpiTile, type DataTableColumn } from '@broker/ui';
import {
  formatMoneyCents,
  formatPnlCents,
  RECENT_TRADES_LIMIT,
  type ClientTrading,
  type TradingPosition,
  type TradingTrade,
} from '@/lib/clients/trading';

/**
 * Блок «Счёт и торговля» карточки клиента. Только чтение проекции торговли
 * (`lib/clients/trading.ts`): баланс, открытые позиции, последние сделки с
 * реализованным P&L, последняя торговая активность. Equity не показываем —
 * текущих цен в проекции нет, выдумывать их нельзя.
 */

function dateFmt(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
}

function num(value: number, max = 8): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: max });
}

const SIDE: Record<'buy' | 'sell', string> = { buy: 'Покупка', sell: 'Продажа' };

function SideCell({ side }: { side: 'buy' | 'sell' }) {
  return <span className={side === 'buy' ? 'text-positive' : 'text-negative'}>{SIDE[side]}</span>;
}

const POSITION_COLUMNS: DataTableColumn<TradingPosition>[] = [
  { key: 'symbol', header: 'Инструмент', cell: (p) => <span className="font-medium">{p.symbol}</span> },
  { key: 'side', header: 'Сторона', width: '7rem', cell: (p) => <SideCell side={p.side} /> },
  { key: 'volume', header: 'Объём', numeric: true, width: '7rem', cell: (p) => num(p.volume) },
  { key: 'entry', header: 'Цена входа', numeric: true, width: '9rem', cell: (p) => num(p.entryPrice) },
  { key: 'updated', header: 'Снимок', numeric: true, width: '11rem', cell: (p) => dateFmt(p.updatedAt) },
];

function tradeColumns(currency: string): DataTableColumn<TradingTrade>[] {
  return [
    { key: 'when', header: 'Когда', width: '11rem', numeric: true, align: 'left', cell: (t) => dateFmt(t.executedAt) },
    { key: 'symbol', header: 'Инструмент', cell: (t) => <span className="font-medium">{t.symbol}</span> },
    { key: 'side', header: 'Сторона', width: '7rem', cell: (t) => <SideCell side={t.side} /> },
    { key: 'volume', header: 'Объём', numeric: true, width: '6rem', cell: (t) => num(t.volume) },
    { key: 'price', header: 'Цена', numeric: true, width: '8rem', cell: (t) => num(t.price) },
    {
      key: 'pnl',
      header: 'P&L',
      numeric: true,
      width: '8rem',
      cell: (t) =>
        t.realizedPnlCents === null ? (
          <span className="text-secondary/60">—</span>
        ) : (
          <span
            className={
              t.realizedPnlCents > 0
                ? 'text-positive'
                : t.realizedPnlCents < 0
                  ? 'text-negative'
                  : 'text-secondary'
            }
          >
            {formatPnlCents(t.realizedPnlCents, currency)}
          </span>
        ),
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

export function TradingSection({
  trading,
  title = 'Счёт и торговля',
  kind = 'demo',
  live,
}: {
  trading: ClientTrading;
  title?: string;
  kind?: 'demo' | 'real';
  /** undefined — не запрашивали; null — терминал не ответил. */
  live?: LiveAccount | null;
}) {
  const currency = trading.account?.currency ?? 'USD';
  const pnl = trading.realizedPnlTotalCents;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">{title}</h2>
      {live !== undefined ? (
        <p className="text-xs text-secondary">
          {live === null
            ? 'Терминал не ответил — equity и свободная маржа сейчас недоступны.'
            : !live.opened
              ? 'Счёт в терминале ещё не открыт.'
              : `Терминал сейчас: equity ${live.equityMinor === null ? '—' : formatMoneyCents(live.equityMinor, currency)} · свободная маржа ${
                  live.freeMarginMinor === null ? '—' : formatMoneyCents(live.freeMarginMinor, currency)
                }${live.tradingFrozen ? ' · ТОРГОВЛЯ ЗАМОРОЖЕНА' : ''}`}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {trading.account ? (
          <KpiTile
            label="Баланс"
            value={formatMoneyCents(trading.account.balanceCents, currency)}
            hint={`${kind === 'real' ? 'реальный счёт' : 'демо-счёт'} · открыт ${new Date(trading.account.openedAt).toLocaleDateString('ru-RU')}`}
          />
        ) : (
          <KpiTile
            label="Баланс"
            value="—"
            hint={kind === 'real' ? 'реальных зачислений ещё не было' : 'счёт ещё не открыт терминалом'}
          />
        )}
        <KpiTile
          label="Открытые позиции"
          value={trading.positions.length}
          hint={live && live.opened ? 'по снимку проекции' : 'equity считает терминал'}
        />
        <KpiTile
          label="Реализованный P&L"
          value={formatPnlCents(pnl, currency)}
          tone={pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : 'default'}
          hint={`сделок всего: ${trading.tradesTotal}`}
        />
        <KpiTile
          label="Последняя активность"
          value={
            <span className="text-base">
              {trading.lastActivityAt ? dateFmt(trading.lastActivityAt) : 'не торговал'}
            </span>
          }
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-secondary">Открытые позиции</h3>
        <DataTable
          aria-label="Открытые позиции клиента"
          columns={POSITION_COLUMNS}
          rows={trading.positions}
          rowKey={(p) => p.id}
          empty="Открытых позиций нет."
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-secondary">
          Последние сделки
          {trading.tradesTotal > RECENT_TRADES_LIMIT
            ? ` (последние ${RECENT_TRADES_LIMIT} из ${trading.tradesTotal})`
            : ''}
        </h3>
        <DataTable
          aria-label="Последние сделки клиента"
          columns={tradeColumns(currency)}
          rows={trading.recentTrades}
          rowKey={(t) => t.id}
          empty="Сделок пока не было."
        />
      </div>

      <p className="text-xs text-secondary">
        Источник — проекция событий терминала (только чтение). Позиции — по цене входа;
        equity и свободная маржа — живым запросом к терминалу (строка вверху блока).
      </p>
    </section>
  );
}
