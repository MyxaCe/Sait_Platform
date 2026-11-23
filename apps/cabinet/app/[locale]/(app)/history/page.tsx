import { Card, CARD } from '@/features/ui/Card';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { EmptyState, StatusBadge, ToneBadge, cn, statusKeyOf } from '@broker/ui';
import { Money } from '@/features/ui/Money';
import { Link } from '@/i18n/navigation';
import { TerminalLink } from '@/features/trade/TerminalLink';
import { requireSessionUser } from '@/lib/auth/require';
import { getAccountHistory, parsePeriod, periodStart, summarizeTrades, type TradeRow } from '@/lib/history';
import { getRealAccount, listMyDeposits, listMyWithdrawals, terminalReader } from '@/lib/money';
import { getClosedDeals } from '@/lib/terminal/client';
import { moneyOpRenderer, toMoneyOps, type MoneyOp } from '@/features/money/MoneyHistory';
import { ClosedDeals } from '@/features/history/ClosedDeals';
import { FilterChips } from '@/features/history/FilterChips';
import { NavIcon } from '@/features/shell/NavIcon';
import { Segmented } from '@/features/ui/Segmented';
import { linkButton } from '@/features/ui/link-button';
import { MachineValue } from '@/features/money/TxLink';
import { PAGE } from '@/features/ui/page';

export const dynamic = 'force-dynamic';

type Kind = 'real' | 'demo';
type TypeFilter = 'all' | 'trades' | 'money';

type FeedItem = { kind: 'trade'; at: Date; trade: TradeRow } | { kind: 'money'; at: Date; op: MoneyOp };

async function realClosedDeals(userId: string) {
  const live = await terminalReader()
    .accounts(userId)
    .catch(() => ({ state: 'unavailable' as const }));
  const real = live.state === 'ok' ? live.accounts.find((a) => a.kind === 'real') : undefined;
  return real?.opened ? getClosedDeals(userId, 'real') : null;
}

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
    // Закрытые сделки из терминала — как на демо, так и на реальном (одинаковый вид). Реальный счёт
    // спрашиваем, только если он уже открыт в терминале: страница истории не должна открывать счёт.
    account === 'demo' ? getClosedDeals(user.id, 'demo') : realClosedDeals(user.id),
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
            {tm(op.kind === 'deposit' ? (op.item.source === 'admin' ? 'opAdminCredit' : 'opDeposit') : 'opWithdrawal')}
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

      {/* Одна колонка карточек одинаковой ширины и стиля: фильтры → итоги → позиции → операции → закрытые сделки. */}
      <Card as="div" bodyClassName="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between" data-history-filters>
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
      </Card>

      {type !== 'money' && summary.trades > 0 ? (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 xl:gap-5" data-history-summary>
          {tiles.map((tile) => (
            <div key={tile.label} className={cn(CARD, 'min-w-0 px-4 py-3 sm:px-5 sm:py-4')}>
              <dt className="text-xs text-muted">{tile.label}</dt>
              <dd className="mt-1 text-[17px] font-semibold leading-6 tracking-tight sm:text-[22px] sm:leading-8">{tile.value}</dd>
              {'hint' in tile && tile.hint ? <dd className="text-xs text-muted">{tile.hint}</dd> : null}
            </div>
          ))}
        </dl>
      ) : null}

      {type !== 'money' && hist.positions.length > 0 ? (
        <Card title={t('openPositions')} titleId="open-pos" count={hist.positions.length} flush>
          <ul className="divide-y divide-border">
            {hist.positions.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
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
        </Card>
      ) : null}

      <Card title={t('feedTitle')} titleId="feed-title" flush={groups.length > 0}>
        {groups.length === 0 ? (
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
        ) : (
          <>
            <div className="xl:hidden">
              {groups.map((g) => (
                <div key={g.key}>
                  <p className="border-b border-border bg-base/40 px-4 py-1.5 text-xs font-medium text-muted">{g.label}</p>
                  <ul className="divide-y divide-border border-b border-border last:border-b-0">
                    {g.items.map((it) => (it.kind === 'trade' ? renderTrade(it.trade) : renderMoney(it.op)))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="hidden overflow-x-auto xl:block">
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
      </Card>

      {closed && type !== 'money' ? <ClosedDeals outcome={closed} currency={hist.currency} /> : null}
    </div>
  );
}
