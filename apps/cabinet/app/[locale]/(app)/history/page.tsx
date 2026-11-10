import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState, Money, cn } from '@broker/ui';
import { Link } from '@/i18n/navigation';
import { TerminalLink } from '@/features/trade/TerminalLink';
import { requireSessionUser } from '@/lib/auth/require';
import { getAccountHistory, parsePeriod, periodStart, summarizeTrades, type TradeRow } from '@/lib/history';
import { getRealAccount, listMyDeposits, listMyWithdrawals } from '@/lib/money';
import { getClosedDeals } from '@/lib/terminal/client';
import { moneyOpRenderer, toMoneyOps, type MoneyOp } from '@/features/money/MoneyHistory';
import { ClosedDeals } from '@/features/history/ClosedDeals';
import { FilterChips } from '@/features/history/FilterChips';
import { NavIcon } from '@/features/shell/NavIcon';
import { Segmented } from '@/features/ui/Segmented';
import { linkButton } from '@/features/ui/link-button';

/**
 * «История» (r2, замечание владельца: «пустая и неинформативная»).
 *
 *   счёт    — Реальный | Демо (`?account=`);
 *   фильтры — период 7/30/90 дней / всё (`?period=`), тип: всё / сделки /
 *             пополнения и выводы (`?type=`, у демо денег нет — фильтра нет);
 *   сводка  — оборот, зафиксированный P&L, число сделок, винрейт за период;
 *   открытые позиции — что сейчас в рынке;
 *   лента   — сделки и денежные операции одной лентой по дням (статусы,
 *             хэши → Tronscan);
 *   пусто   — объясняет почему и ведёт к действию (терминал / пополнение).
 *
 * Источник сделок — проекция терминала (`*_trades`, `*_positions`); денег —
 * заявки ввода/вывода. Всё по userId из сессии, всё только чтение.
 */
export const dynamic = 'force-dynamic';

type Kind = 'real' | 'demo';
type TypeFilter = 'all' | 'trades' | 'money';

type FeedItem = { kind: 'trade'; at: Date; trade: TradeRow } | { kind: 'money'; at: Date; op: MoneyOp };

export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams: { account?: string; period?: string; type?: string };
}) {
  setRequestLocale(params.locale);
  const user = await requireSessionUser(params.locale);
  const t = await getTranslations('history');
  const th = await getTranslations('home');
  const format = await getFormatter();

  const realAccount = await getRealAccount(user.id);
  // По умолчанию — реальный счёт, если он есть; иначе демо (новый клиент).
  const account: Kind =
    searchParams.account === 'demo' || searchParams.account === 'real'
      ? searchParams.account
      : realAccount
        ? 'real'
        : 'demo';
  const period = parsePeriod(searchParams.period);
  const type: TypeFilter =
    account === 'demo' ? 'trades' : searchParams.type === 'trades' || searchParams.type === 'money' ? searchParams.type : 'all';

  const since = periodStart(period);
  const [hist, deposits, withdrawals, closed] = await Promise.all([
    getAccountHistory(user.id, account, period),
    account === 'real' ? listMyDeposits(user.id) : Promise.resolve([]),
    account === 'real' ? listMyWithdrawals(user.id) : Promise.resolve([]),
    account === 'demo' ? getClosedDeals(user.id) : Promise.resolve(null),
  ]);
  const summary = summarizeTrades(hist.trades);
  const ops = toMoneyOps(deposits, withdrawals).filter((o) => since === null || o.at >= since);

  const feed: FeedItem[] = [
    ...(type !== 'money' ? hist.trades.map((tr) => ({ kind: 'trade' as const, at: tr.executedAt, trade: tr })) : []),
    ...(type !== 'trades' ? ops.map((op) => ({ kind: 'money' as const, at: op.at, op })) : []),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const renderMoney = await moneyOpRenderer();
  const qs = (patch: Partial<{ account: Kind; period: string; type: TypeFilter }>) => {
    const p = new URLSearchParams({ account, period, type, ...patch });
    if (p.get('type') === 'all' || (patch.account ?? account) === 'demo') p.delete('type');
    if (p.get('period') === '30d') p.delete('period');
    return `/history?${p.toString()}`;
  };

  const num = (v: number, max = 5) => format.number(v, { maximumFractionDigits: max });
  // День — в том же часовом поясе, что и подписи времени (форматтер next-intl).
  const dayKey = (d: Date) => format.dateTime(d, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  const dayLabel = (d: Date) => {
    const k = dayKey(d);
    return k === today ? t('today') : k === yesterday ? t('yesterday') : format.dateTime(d, { dateStyle: 'long' });
  };
  const groups: { key: string; label: string; items: FeedItem[] }[] = [];
  for (const it of feed) {
    const k = dayKey(it.at);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.items.push(it);
    else groups.push({ key: k, label: dayLabel(it.at), items: [it] });
  }

  const renderTrade = (tr: TradeRow) => (
    <li key={`t-${tr.id}`} className="flex items-start gap-3 px-4 py-3" data-op="trade">
      <span
        aria-hidden
        className={cn(
          'mt-0.5 grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold',
          tr.side === 'buy' ? 'bg-info/10 text-info' : 'bg-warning/10 text-warning',
        )}
      >
        {tr.side === 'buy' ? '↗' : '↘'}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-semibold">{tr.symbol}</span>
          <span className={tr.side === 'buy' ? 'text-info' : 'text-warning'}>{t(tr.side === 'buy' ? 'buy' : 'sell')}</span>
        </span>
        <span className="text-xs tabular-nums text-secondary">
          {t('fill', { volume: num(tr.volume, 4), price: num(tr.price) })}
        </span>
        <span className="text-xs tabular-nums text-muted">
          {format.dateTime(tr.executedAt, { timeStyle: 'short' })} · #{tr.tradeId}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
        {tr.realizedPnlCents === null ? (
          <span className="text-xs text-muted">{t('opening')}</span>
        ) : (
          <>
            <span className="text-sm font-medium">
              <Money minor={tr.realizedPnlCents} currency={hist.currency} signed tone="auto" />
            </span>
            <span className="text-xs text-muted">{t('closing')}</span>
          </>
        )}
      </div>
    </li>
  );

  const tiles = [
    { label: t('sumTurnover'), value: <Money minor={summary.turnoverMinor} currency={hist.currency} /> },
    { label: t('sumPnl'), value: <Money minor={summary.pnlMinor} currency={hist.currency} signed tone="auto" /> },
    { label: t('sumTrades'), value: <span className="tabular-nums">{summary.trades}</span> },
    {
      label: t('sumWinRate'),
      value:
        summary.winRate === null ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="tabular-nums">{format.number(summary.winRate, { style: 'percent', maximumFractionDigits: 0 })}</span>
        ),
      hint: summary.closed > 0 ? t('winHint', { wins: summary.wins, closed: summary.closed }) : t('winNone'),
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4 sm:space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-secondary">{t('lead')}</p>
      </div>

      <Segmented
        label={t('accountSwitch')}
        active={account}
        items={[
          { key: 'real', label: th('realAccountTitle'), href: qs({ account: 'real' }) },
          { key: 'demo', label: th('demoAccountTitle'), href: qs({ account: 'demo' }) },
        ]}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <FilterChips
          label={t('periodLabel')}
          active={period}
          items={(['7d', '30d', '90d', 'all'] as const).map((p) => ({ key: p, label: t(`period.${p}`), href: qs({ period: p }) }))}
        />
        {account === 'real' ? (
          <FilterChips
            label={t('typeLabel')}
            active={type}
            items={(['all', 'trades', 'money'] as const).map((k) => ({ key: k, label: t(`type.${k}`), href: qs({ type: k }) }))}
          />
        ) : null}
      </div>

      {/* Сводка из нулей — шум: при пустом периоде говорит пустое состояние ниже. */}
      {type !== 'money' && summary.trades > 0 ? (
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.label} className="bg-elevated px-4 py-3">
              <dt className="text-xs text-muted">{tile.label}</dt>
              <dd className="mt-1 text-[17px] font-semibold leading-6">{tile.value}</dd>
              {'hint' in tile && tile.hint ? <dd className="text-xs text-muted">{tile.hint}</dd> : null}
            </div>
          ))}
        </dl>
      ) : null}

      {type !== 'money' && hist.positions.length > 0 ? (
        <section className="space-y-2" aria-labelledby="open-pos">
          <h2 id="open-pos" className="text-sm font-semibold">
            {t('openPositions')} <span className="font-normal text-muted">{hist.positions.length}</span>
          </h2>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-elevated">
            {hist.positions.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="font-semibold">{p.symbol}</span>
                  <span className={p.side === 'buy' ? 'text-info' : 'text-warning'}>{t(p.side === 'buy' ? 'buy' : 'sell')}</span>
                </span>
                <span className="text-xs tabular-nums text-secondary">
                  {t('positionLine', { volume: num(p.volume, 4), price: num(p.entryPrice) })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3" aria-labelledby="feed-title">
        <h2 id="feed-title" className="text-sm font-semibold">
          {t('feedTitle')}
        </h2>
        {groups.length === 0 ? (
          <div className="rounded-2xl border border-border bg-elevated">
            <EmptyState
              title={type === 'money' ? t('emptyMoney') : t('emptyTitle')}
              description={type === 'money' ? t('emptyMoneyHint') : t('emptyHint')}
              action={
                type === 'money' ? (
                  <Link href="/wallet?tab=deposit" className={linkButton('primary')}>
                    {th('btnDeposit')}
                  </Link>
                ) : (
                  <TerminalLink account={account} className={linkButton('primary')}>
                    <NavIcon name="trade" className="size-[18px]" />
                    {t('emptyCta')}
                  </TerminalLink>
                )
              }
            />
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.key} className="space-y-1.5">
              <p className="px-1 text-xs font-medium text-muted">{g.label}</p>
              <ul className="divide-y divide-border rounded-2xl border border-border bg-elevated">
                {g.items.map((it) => (it.kind === 'trade' ? renderTrade(it.trade) : renderMoney(it.op)))}
              </ul>
            </div>
          ))
        )}
      </section>

      {closed ? <ClosedDeals outcome={closed} /> : null}
    </div>
  );
}
