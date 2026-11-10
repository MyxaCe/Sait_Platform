import { useLocale, useTranslations } from 'next-intl';
import { Callout, cn, EmptyState, formatMoney, Money, ToneBadge, type StatusTone } from '@broker/ui';
import type { ContestLeaderboard, ContestSummary, LeaderboardRow } from '@broker/promo';
import { FilterChips } from '@/features/history/FilterChips';
import { Link } from '@/i18n/navigation';
import { linkButton } from '@/features/ui/link-button';
import { JoinContestForm } from './JoinContestForm';
import { CARD } from './PromoCards';
import { SectionTitle } from './PromotionsScreen';
import { contestTab, daysLeft, formatDate, formatShortDate, PROMO_CURRENCY, signedBpsPercent } from './format';

const PHASE_TONE: Record<ContestSummary['phase'], StatusTone> = {
  draft: 'neutral',
  upcoming: 'info',
  running: 'positive',
  finished: 'warning',
  finalized: 'neutral',
};

const TAB_ORDER = { running: 0, upcoming: 1, finished: 2 } as const;

/**
 * «Конкурс» (решение владельца №4): турнир на демо-счетах. Вкладки
 * идущих/будущих/завершённых, правила и призы — из данных, лидерборд с
 * маскированными именами и закреплённым «моим местом», «Участвовать» с
 * предупреждением о сбросе демо.
 */
export function ContestScreen({
  contests,
  selected,
  board,
  demoCurrency,
  now,
}: {
  contests: ContestSummary[] | null;
  selected: ContestSummary | null;
  board: ContestLeaderboard | null;
  demoCurrency: string;
  now?: Date;
}) {
  const t = useTranslations('contest');
  const locale = useLocale();

  const sorted = (contests ?? [])
    .filter((c) => contestTab(c) !== null)
    .sort((a, b) => TAB_ORDER[contestTab(a)!] - TAB_ORDER[contestTab(b)!] || Date.parse(b.endsAt) - Date.parse(a.endsAt));

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-secondary">{t('lead')}</p>
      </header>

      {contests === null ? (
        <Callout tone="warning" title={t('unavailableTitle')}>
          {t('unavailable')}
        </Callout>
      ) : sorted.length === 0 || !selected ? (
        <div className={CARD}>
          <EmptyState title={t('empty')} />
        </div>
      ) : (
        <>
          {sorted.length > 1 ? (
            <FilterChips
              label={t('tabs.label')}
              active={selected.promotionId}
              items={sorted.map((c) => ({
                key: c.promotionId,
                label: `${t(`tabs.${contestTab(c)!}`)} · ${c.texts.title}`,
                href: `/contest?id=${c.promotionId}`,
              }))}
            />
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-5">
            <div className="min-w-0 space-y-4">
              <ContestHeader c={selected} demoCurrency={demoCurrency} now={now} />
              {board?.me ? <MyPlace me={board.me} minTrades={selected.rules.minTrades} /> : null}
              <section aria-labelledby="lb" className="space-y-3">
                <SectionTitle id="lb">{t('leaderboardTitle')}</SectionTitle>
                <div className={cn(CARD, 'p-0 sm:p-0')}>
                  {board === null ? (
                    <div className="p-4">
                      <Callout tone="warning">{t('unavailable')}</Callout>
                    </div>
                  ) : (
                    <Leaderboard board={board} />
                  )}
                </div>
                {board ? (
                  <p className="text-xs text-muted">
                    {board.final ? t('finalNote', { date: formatDate(board.computedAt, locale) ?? '—' }) : t('liveNote')}
                  </p>
                ) : null}
              </section>
            </div>
            <aside className="space-y-4">
              <Prizes c={selected} />
              <Rules c={selected} demoCurrency={demoCurrency} />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function ContestHeader({ c, demoCurrency, now }: { c: ContestSummary; demoCurrency: string; now?: Date }) {
  const t = useTranslations('contest');
  const locale = useLocale();
  const startsIn = c.phase === 'upcoming' ? daysLeft(c.startsAt, now) : null;
  const endsIn = c.phase === 'running' ? daysLeft(c.endsAt, now) : null;
  const canJoin = (c.phase === 'running' || c.phase === 'upcoming') && (c.myStatus === null || c.myStatus === 'withdrawn');
  const startBalance = formatMoney(c.rules.startBalanceMinor, demoCurrency);

  return (
    <section className={cn(CARD, 'space-y-4', c.myStatus === 'active' && 'border-accent/40')} data-contest={c.slug}>
      <div className="flex flex-wrap items-center gap-2">
        <ToneBadge tone={PHASE_TONE[c.phase]}>{t(`phase.${c.phase === 'draft' ? 'upcoming' : c.phase}`)}</ToneBadge>
        <span className="text-xs text-muted">
          {t('period', { from: formatShortDate(c.startsAt, locale) ?? '—', to: formatDate(c.endsAt, locale) ?? '—' })}
        </span>
      </div>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{c.texts.title}</h2>
        {c.texts.summary ? <p className="mt-1 text-sm text-secondary">{c.texts.summary}</p> : null}
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
        <Fact
          className="col-span-2 sm:col-span-1"
          label={t('factStart')}
          value={<Money minor={c.rules.startBalanceMinor} currency={demoCurrency} />}
        />
        <Fact label={t('factParticipants')} value={<span className="tabular-nums">{c.participants}</span>} />
        {startsIn !== null ? (
          <Fact label={t('factDaysToStart')} value={<span className="tabular-nums">{startsIn}</span>} />
        ) : endsIn !== null ? (
          <Fact label={t('factDaysToEnd')} value={<span className="tabular-nums">{endsIn}</span>} />
        ) : (
          <Fact label={t('factDone')} value={<span className="text-sm">{t(`phase.${c.phase === 'draft' ? 'upcoming' : c.phase}`)}</span>} />
        )}
      </dl>
      {c.myStatus ? (
        <p className="text-sm font-medium text-primary" data-testid="my-status">
          {t(`myStatus.${c.myStatus}`)}
        </p>
      ) : null}
      {canJoin ? <JoinContestForm promotionId={c.promotionId} startBalance={startBalance} /> : null}
      {c.myStatus === 'active' && c.phase === 'running' ? (
        <Link href="/trade?account=demo" className={linkButton('secondary', 'w-full sm:w-auto')}>
          {t('toTerminal')}
        </Link>
      ) : null}
    </section>
  );
}

function Fact({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded-xl bg-sunken px-3 py-2.5", className)}>
      <dt className="truncate text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-[15px] font-semibold">{value}</dd>
    </div>
  );
}

function MyPlace({ me, minTrades }: { me: LeaderboardRow; minTrades: number }) {
  const t = useTranslations('contest');
  const locale = useLocale();
  return (
    <section
      aria-label={t('myPlace')}
      className="sticky top-16 z-10 rounded-2xl border border-accent/50 bg-elevated p-4 shadow-sm lg:static"
      data-testid="my-place"
    >
      <div className="flex items-center gap-4">
        <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent/[0.14] text-accent">
          <span className="text-lg font-bold tabular-nums">{me.place !== null ? `#${me.place}` : '—'}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">{t('myPlace')}</p>
          <p className="truncate text-sm font-medium">
            {me.place !== null
              ? `${me.displayName} · ${t('me')}`
              : me.ineligible
                ? t(`ineligible.${me.ineligible}`, { n: Math.max(0, minTrades - me.tradesCount) })
                : t('noPlace')}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p
            className={cn(
              'text-lg font-semibold tabular-nums',
              me.returnBps === null ? 'text-muted' : me.returnBps > 0 ? 'text-positive' : me.returnBps < 0 ? 'text-negative' : 'text-primary',
            )}
          >
            {me.returnBps !== null ? signedBpsPercent(me.returnBps, locale) : '—'}
          </p>
          <p className="text-xs text-muted">
            {t('myTrades')}: <span className="tabular-nums">{me.tradesCount}</span>
          </p>
        </div>
      </div>
      {me.prizeMinor !== null ? (
        <p className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3 text-sm">
          <span className="text-secondary">{t('col.prize')}</span>
          <Money minor={me.prizeMinor} currency={PROMO_CURRENCY} className="font-semibold text-positive" />
        </p>
      ) : null}
    </section>
  );
}

function Leaderboard({ board }: { board: ContestLeaderboard }) {
  const t = useTranslations('contest');
  const locale = useLocale();
  const rows = [...board.rows];
  // Моё место вне выдачи (ниже лимита) — дописываем в конец, чтобы клиент себя видел.
  if (board.me && board.me.place !== null && !rows.some((r) => r.isMe)) rows.push(board.me);
  if (rows.length === 0) return <EmptyState size="compact" title={t('leaderboardEmpty')} className="px-4" />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]" data-testid="leaderboard">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th scope="col" className="w-14 px-4 py-2.5 font-medium">
              {t('col.place')}
            </th>
            <th scope="col" className="px-2 py-2.5 font-medium">
              {t('col.trader')}
            </th>
            <th scope="col" className="px-2 py-2.5 text-right font-medium">
              {t('col.return')}
            </th>
            <th scope="col" className="px-2 py-2.5 text-right font-medium">
              {t('col.trades')}
            </th>
            <th scope="col" className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">
              {t('col.prize')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={`${r.place}-${i}`}
              className={cn('border-b border-border last:border-0', r.isMe && 'bg-accent/[0.08]')}
              aria-current={r.isMe ? 'true' : undefined}
              data-me={r.isMe ? 'yes' : undefined}
            >
              <td className="px-4 py-2.5 font-semibold tabular-nums">
                <Medal place={r.place} />
              </td>
              <td className="max-w-[9rem] truncate px-2 py-2.5 sm:max-w-none">
                {r.displayName}
                {r.isMe ? <span className="ml-1.5 text-xs font-semibold text-accent">· {t('me')}</span> : null}
              </td>
              <td
                className={cn(
                  'whitespace-nowrap px-2 py-2.5 text-right font-medium tabular-nums',
                  r.returnBps === null ? 'text-muted' : r.returnBps > 0 ? 'text-positive' : r.returnBps < 0 ? 'text-negative' : '',
                )}
              >
                {r.returnBps !== null ? signedBpsPercent(r.returnBps, locale) : '—'}
              </td>
              <td className="px-2 py-2.5 text-right tabular-nums text-secondary">{r.tradesCount}</td>
              <td className="hidden px-4 py-2.5 text-right sm:table-cell">
                {r.prizeMinor !== null ? <Money minor={r.prizeMinor} currency={PROMO_CURRENCY} /> : <span className="text-muted">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Medal({ place }: { place: number | null }) {
  if (place === null) return <span className="text-muted">—</span>;
  const tone = place === 1 ? 'bg-warning/20 text-warning' : place === 2 ? 'bg-primary/10 text-primary' : place === 3 ? 'bg-warning/10 text-secondary' : '';
  return tone ? (
    <span className={cn('inline-grid size-6 place-items-center rounded-full text-xs', tone)}>{place}</span>
  ) : (
    <span className="inline-grid size-6 place-items-center text-secondary">{place}</span>
  );
}

function Prizes({ c }: { c: ContestSummary }) {
  const t = useTranslations('contest');
  const total = c.rules.prizes.reduce((s, p) => s + p.amountMinor, 0);
  return (
    <section className={cn(CARD, 'space-y-3')} aria-labelledby="prizes">
      <h2 id="prizes" className="font-semibold">
        {t('prizesTitle')}
      </h2>
      {c.rules.prizes.length > 0 ? (
        <ul className="space-y-2">
          {c.rules.prizes.map((p) => (
            <li key={p.place} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 text-secondary">
                <Medal place={p.place} />
                {t('prizePlace', { place: p.place })}
              </span>
              <Money minor={p.amountMinor} currency={PROMO_CURRENCY} className="font-semibold" />
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 border-t border-border pt-2 text-sm">
            <span className="text-secondary">{t('prizesTotal')}</span>
            <Money minor={total} currency={PROMO_CURRENCY} className="font-semibold" />
          </li>
        </ul>
      ) : (
        <p className="text-sm text-muted">—</p>
      )}
      <p className="text-xs text-muted">{t('prizesNote')}</p>
    </section>
  );
}

function Rules({ c, demoCurrency }: { c: ContestSummary; demoCurrency: string }) {
  const t = useTranslations('contest');
  const tr = useTranslations('promo.rules');
  const lines = [
    tr('startBalance', { amount: formatMoney(c.rules.startBalanceMinor, demoCurrency) }),
    tr('minTrades', { n: c.rules.minTrades }),
    t('ranking'),
    ...(c.rules.prizeRequiresKyc ? [tr('prizeKyc')] : []),
  ];
  return (
    <section className={cn(CARD, 'space-y-3')} aria-labelledby="rules">
      <h2 id="rules" className="font-semibold">
        {t('rulesTitle')}
      </h2>
      <ul className="space-y-1.5 text-sm text-secondary">
        {lines.map((l) => (
          <li key={l} className="flex gap-2">
            <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-muted" />
            {l}
          </li>
        ))}
      </ul>
      {c.texts.terms ? <p className="whitespace-pre-line text-xs text-muted">{c.texts.terms}</p> : null}
    </section>
  );
}
