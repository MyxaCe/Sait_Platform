import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState, Money, StatusBadge, ToneBadge, cn, statusKeyOf } from '@broker/ui';
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
import { MachineValue } from '@/features/money/TxLink';
import { PAGE } from '@/features/ui/page';

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
  const tm = await getTranslations('money');
  const tc = await getTranslations('common');
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

  const dash = <span className="text-muted">—</span>;
  const tradeRow = (tr: TradeRow) => (
    <tr key={`tt-${tr.id}`} className="hover:bg-primary/[0.03]" data-op="trade">
      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-secondary">
        {format.dateTime(tr.executedAt, { timeStyle: 'short' })}
      </td>
      <td className="px-3 py-2.5">{t(tr.realizedPnlCents === null ? 'opening' : 'closing')}</td>
      <td className="px-3 py-2.5">
        <span className="font-semibold">{tr.symbol}</span>
        <span className="ml-2 text-xs text-muted">#{tr.tradeId}</span>
      </td>
      <td className={cn('px-3 py-2.5', tr.side === 'buy' ? 'text-info' : 'text-warning')}>
        {t(tr.side === 'buy' ? 'buy' : 'sell')}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">{num(tr.volume, 4)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{num(tr.price)}</td>
      <td className="px-3 py-2.5 text-right font-medium">
        {tr.realizedPnlCents === null ? dash : <Money minor={tr.realizedPnlCents} currency={hist.currency} signed tone="auto" hideCurrency />}
      </td>
      <td className="px-4 py-2.5 text-right">{dash}</td>
    </tr>
  );
  const moneyStatus = (domain: 'deposit' | 'withdrawal', st: string) => {
    const own = `status.${domain}_${st}`;
    const label = tm.has(own) ? tm(own) : tm.has(`status.${st}`) ? tm(`status.${st}`) : st;
    const key = statusKeyOf(`${domain}_${st}`);
    return key ? <StatusBadge status={key} label={label} /> : <ToneBadge tone="neutral">{label}</ToneBadge>;
  };
  const moneyRow = (op: MoneyOp) => {
    const dep = op.kind === 'deposit';
    const minor = op.item.amountMinor;
    const hash = op.kind === 'deposit' ? op.item.txHash : op.item.payoutTxHash;
    const voided = op.item.status === 'rejected' || op.item.status === 'cancelled';
    return (
      <tr key={`tm-${op.kind}-${op.item.id}`} className="hover:bg-primary/[0.03]" data-op={op.kind}>
        <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-secondary">
          {format.dateTime(op.at, { timeStyle: 'short' })}
        </td>
        <td className="px-3 py-2.5">
          <span className="inline-flex items-center gap-1.5">
            <NavIcon name={dep ? 'deposit' : 'withdraw'} className={cn('size-4', dep ? 'text-positive' : 'text-secondary')} />
            {tm(dep ? 'opDeposit' : 'opWithdrawal')}
          </span>
        </td>
        <td className="max-w-[18rem] px-3 py-1.5">
          {hash ? (
            <MachineValue
              value={hash}
              label="USDT"
              copyLabel={`${tc('copy')}: ${tm('copyHash')}`}
              copiedLabel={tc('copied')}
              tronscanLabel={tm('openTronscan')}
              tx
            />
          ) : (
            <span className="text-secondary">USDT · TRC20</span>
          )}
        </td>
        <td className="px-3 py-2.5">{dash}</td>
        <td className="px-3 py-2.5 text-right">{dash}</td>
        <td className="px-3 py-2.5 text-right">{dash}</td>
        <td className="px-3 py-2.5 text-right font-medium">
          <Money
            minor={minor === null ? null : dep ? minor : -minor}
            currency="USDT"
            signed
            hideCurrency
            className={cn(voided && 'text-muted line-through')}
          />
        </td>
        <td className="px-4 py-2.5 text-right">{moneyStatus(dep ? 'deposit' : 'withdrawal', op.item.status)}</td>
      </tr>
    );
  };

  /*
   * Раскладка (десктоп, 10.11). < xl — прежняя колонка (телефон не меняется).
   * ≥ xl: шапка со счётом справа → ряд KPI во всю ширину → панель фильтров
   * строкой → лента таблицей; ≥ 2xl: фильтры и открытые позиции — колонкой
   * слева (3), таблица справа (9). KPI на
   * десктопе — отдельная копия (только чтение), чтобы порядок на телефоне
   * («фильтры → сводка») остался прежним.
   */
  return (
    <div className={cn(PAGE, 'space-y-4 sm:space-y-5')}>
      <div className="space-y-4 sm:space-y-5 xl:flex xl:items-end xl:justify-between xl:gap-6 xl:space-y-0">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t('title')}</h1>
          <p className="mt-1 text-sm text-secondary">{t('lead')}</p>
        </div>
        <div className="xl:w-[380px] xl:shrink-0">
          <Segmented
            label={t('accountSwitch')}
            active={account}
            items={[
              { key: 'real', label: th('realAccountTitle'), href: qs({ account: 'real' }) },
              { key: 'demo', label: th('demoAccountTitle'), href: qs({ account: 'demo' }) },
            ]}
          />
        </div>
      </div>

      {/* Сводка из нулей — шум: при пустом периоде говорит пустое состояние ниже. */}
      {type !== 'money' && summary.trades > 0 ? (
        <dl className="hidden gap-px overflow-hidden rounded-2xl border border-border bg-border xl:grid xl:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.label} className="bg-elevated px-5 py-4">
              <dt className="text-xs text-muted">{tile.label}</dt>
              <dd className="mt-1 text-[22px] font-semibold leading-8 tracking-tight">{tile.value}</dd>
              {'hint' in tile && tile.hint ? <dd className="text-xs text-muted">{tile.hint}</dd> : null}
            </div>
          ))}
        </dl>
      ) : null}

      <div className="space-y-4 sm:space-y-5 2xl:grid 2xl:grid-cols-12 2xl:items-start 2xl:gap-5 2xl:space-y-0">
        <div className="space-y-4 sm:space-y-5 2xl:sticky 2xl:top-6 2xl:col-span-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between xl:gap-6 xl:rounded-2xl xl:border xl:border-border xl:bg-elevated xl:p-4 2xl:flex-col 2xl:items-stretch 2xl:gap-4">
            <FilterChips
              vertical
              label={t('periodLabel')}
              active={period}
              items={(['7d', '30d', '90d', 'all'] as const).map((p) => ({ key: p, label: t(`period.${p}`), href: qs({ period: p }) }))}
            />
            {account === 'real' ? (
              <FilterChips
                vertical
                label={t('typeLabel')}
                active={type}
                items={(['all', 'trades', 'money'] as const).map((k) => ({ key: k, label: t(`type.${k}`), href: qs({ type: k }) }))}
              />
            ) : null}
          </div>

          {/* Сводка из нулей — шум: при пустом периоде говорит пустое состояние ниже. */}
          {type !== 'money' && summary.trades > 0 ? (
            <dl className="grid grid-cols-2 xl:hidden gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
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
        </div>

        <div className="space-y-4 sm:space-y-5 2xl:col-span-9">
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
              <>
              {groups.map((g) => (
                <div key={g.key} className="space-y-1.5 xl:hidden">
                  <p className="px-1 text-xs font-medium text-muted">{g.label}</p>
                  <ul className="divide-y divide-border rounded-2xl border border-border bg-elevated">
                    {g.items.map((it) => (it.kind === 'trade' ? renderTrade(it.trade) : renderMoney(it.op)))}
                  </ul>
                </div>
              ))}
              {/* ≥ xl — таблица: колонки сравниваются взглядом, дни — строками-разделителями. */}
              <div className="hidden overflow-hidden rounded-2xl border border-border bg-elevated xl:block">
                <table className="w-full text-[13px]">
                  <thead className="bg-primary/[0.03] text-left text-xs text-secondary">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">{t('col.time')}</th>
                      <th className="px-3 py-2.5 font-medium">{t('col.type')}</th>
                      <th className="px-3 py-2.5 font-medium">{t('col.instrument')}</th>
                      <th className="px-3 py-2.5 font-medium">{t('col.side')}</th>
                      <th className="px-3 py-2.5 text-right font-medium">{t('col.volume')}</th>
                      <th className="px-3 py-2.5 text-right font-medium">{t('col.price')}</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-right font-medium">{t('col.amount', { currency: hist.currency })}</th>
                      <th className="px-4 py-2.5 text-right font-medium">{t('col.status')}</th>
                    </tr>
                  </thead>
                  {groups.map((g) => (
                    <tbody key={g.key} className="divide-y divide-border border-t border-border">
                      <tr>
                        <th colSpan={8} scope="rowgroup" className="bg-base/40 px-4 py-1.5 text-left text-xs font-medium text-muted">
                          {g.label}
                        </th>
                      </tr>
                      {g.items.map((it) => (it.kind === 'trade' ? tradeRow(it.trade) : moneyRow(it.op)))}
                    </tbody>
                  ))}
                </table>
              </div>
              </>
            )}
          </section>

          {closed ? <ClosedDeals outcome={closed} /> : null}
        </div>
      </div>
    </div>
  );
}
