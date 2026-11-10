import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Callout, DataTable, EmptyState, Money, Panel, ToneBadge, type DataTableColumn } from '@broker/ui';
import { contestPhase, readContestStandings, type ContestStanding } from '@broker/promo';
import { getOperatorSession } from '@/lib/auth/current';
import { getPool, type Queryable } from '@/lib/db';
import { CONTEST_PHASE, INELIGIBLE } from '@/lib/promo/labels';
import { contestEntryCounts, finalSnapshot, getPromoSettings, listPromotionsWithStats, queueCounts } from '@/lib/promo/queries';
import { canManagePromo, canViewPromo } from '@/lib/promo/runtime';
import { fmtDate, fmtDateTime } from '@/lib/ui/format';
import { PromoHeader } from '../_components/PromoHeader';
import { FinalizeForm } from '../_components/PromoForms';
import { RulesList } from '../_components/RulesList';

/**
 * Конкурсы на демо-счетах: список, лидерборд выбранного (`?c=<id>`), итоги.
 * Доходность = Σ realized P&L закрытых демо-сделок в окне / база после
 * сброса демо. После итогов — итоговый снимок, призы в очереди начислений.
 */
export const dynamic = 'force-dynamic';

function returnText(bps: number | null) {
  if (bps === null) return <span className="text-muted">—</span>;
  const v = (bps / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <span className={bps > 0 ? 'text-positive font-medium' : bps < 0 ? 'text-negative font-medium' : 'text-secondary'}>{bps > 0 ? `+${v}` : v.replace('-', '−')} %</span>;
}

const standingColumns: DataTableColumn<ContestStanding>[] = [
  { key: 'place', header: 'Место', numeric: true, width: '4.5rem', cell: (s) => (s.place ? <span className="font-semibold">{s.place}</span> : <span className="text-muted">—</span>) },
  {
    key: 'who',
    header: 'Участник',
    cell: (s) => (
      <Link href={`/clients/${s.userId}`} className="group block min-w-0">
        <span className="text-primary group-hover:text-accent block truncate font-medium">{s.displayName}</span>
        {s.ineligible ? <span className="text-muted block text-xs">вне зачёта: {INELIGIBLE[s.ineligible] ?? s.ineligible}</span> : null}
      </Link>
    ),
  },
  { key: 'return', header: 'Доходность', numeric: true, width: '8rem', cell: (s) => returnText(s.returnBps) },
  { key: 'pnl', header: 'P&L демо, USD', numeric: true, width: '9rem', cell: (s) => <Money minor={s.pnlMinor} currency="USD" hideCurrency signed tone="auto" /> },
  { key: 'trades', header: 'Сделок', numeric: true, width: '5.5rem', cell: (s) => s.tradesCount },
  {
    key: 'prize',
    header: 'Приз, USDT',
    numeric: true,
    width: '9rem',
    cell: (s) =>
      s.prizeMinor ? (
        <span className="inline-flex flex-col items-end">
          <Money minor={s.prizeMinor} currency="USDT" hideCurrency className="font-medium" />
          {s.prizeBlockedByKyc ? <span className="text-warning text-xs">нужен KYC</span> : null}
        </span>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
];

export default async function ContestsPage({ searchParams }: { searchParams: { c?: string } }) {
  const operator = await getOperatorSession();
  if (!canViewPromo(operator?.role)) notFound();
  const isAdmin = canManagePromo(operator?.role);
  const now = new Date();
  const [all, settings, counts] = await Promise.all([listPromotionsWithStats(), getPromoSettings(), queueCounts()]);
  const contests = all.filter((p) => p.type === 'contest');
  const finals = new Map(await Promise.all(contests.map(async (c) => [c.id, await finalSnapshot(c.id)] as const)));
  const selected = contests.find((c) => c.id === searchParams.c) ?? contests.find((c) => c.status === 'active') ?? contests[0];

  let standings: ContestStanding[] = [];
  let entryCounts: Record<string, number> = {};
  const final = selected ? finals.get(selected.id) ?? null : null;
  if (selected?.parsed?.type === 'contest') {
    standings = final ? (final.standings as ContestStanding[]) : await readContestStandings(getPool() as unknown as Queryable, selected, selected.parsed.rules, now);
    entryCounts = await contestEntryCounts(selected.id);
  }
  const phase = selected ? contestPhase(selected, !!final, now) : null;
  const prizes = standings.filter((s) => s.place !== null && s.prizeMinor !== null && !s.prizeBlockedByKyc);

  return (
    <div className="space-y-6">
      <PromoHeader
        active="contests"
        settings={settings}
        queueCount={counts.pending}
        actions={
          isAdmin ? (
            <Link href="/promo/new?type=contest" className="border-border-strong text-primary hover:bg-primary/[0.04] inline-flex h-9 items-center rounded-md border px-3.5 text-sm">
              Новый конкурс
            </Link>
          ) : null
        }
      />

      {contests.length === 0 ? (
        <Panel>
          <EmptyState size="compact" title="Конкурсов нет" description="Конкурс — акция типа «Конкурс на демо»: период, стартовая сумма, мин. сделок и призы задаются в форме акции." />
        </Panel>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-5">
            {selected ? (
              <Panel
                title={
                  <span className="flex items-center gap-2">
                    Лидерборд · {selected.title}
                    {phase ? <ToneBadge tone={CONTEST_PHASE[phase]!.tone}>{CONTEST_PHASE[phase]!.label}</ToneBadge> : null}
                  </span>
                }
                description={
                  final
                    ? `Итоговый снимок от ${fmtDateTime(final.takenAt)} — не меняется.`
                    : `Живой расчёт на ${fmtDateTime(now)}: Σ результатов закрытых демо-сделок в окне / база после сброса.`
                }
                flush
                actions={
                  <Link href={`/promo/${selected.id}`} className="text-accent text-[13px] font-medium hover:underline">
                    Карточка →
                  </Link>
                }
              >
                <DataTable
                  bare
                  columns={standingColumns}
                  rows={standings}
                  rowKey={(s) => s.userId}
                  rowTone={(s) => (s.prizeBlockedByKyc ? 'warning' : undefined)}
                  empty={<EmptyState size="compact" title="Участников пока нет" description="Клиенты вступают в кабинете; вступление сбрасывает их демо-счёт до стартовой суммы." />}
                />
              </Panel>
            ) : null}

            <Panel title="Все конкурсы" count={contests.length} flush>
              <DataTable
                bare
                columns={[
                  {
                    key: 't',
                    header: 'Конкурс',
                    cell: (c) => (
                      <Link href={`/promo/contests?c=${c.id}`} className="group block min-w-0">
                        <span className="text-primary group-hover:text-accent block truncate font-medium">{c.title}</span>
                        <span className="text-muted block font-mono text-xs">{c.slug}</span>
                      </Link>
                    ),
                  },
                  { key: 'p', header: 'Период', width: '13rem', cell: (c) => <span className="tabular-nums">{c.startsAt ? fmtDate(c.startsAt) : '…'} — {c.endsAt ? fmtDate(c.endsAt) : '…'}</span> },
                  {
                    key: 's',
                    header: 'Фаза',
                    width: '10rem',
                    cell: (c) => {
                      const ph = contestPhase(c, !!finals.get(c.id), now);
                      return <ToneBadge tone={CONTEST_PHASE[ph]!.tone}>{CONTEST_PHASE[ph]!.label}</ToneBadge>;
                    },
                  },
                  { key: 'n', header: 'Участники', numeric: true, width: '6.5rem', cell: (c) => c.participants },
                ]}
                rows={contests}
                rowKey={(c) => c.id}
                selectedKey={selected?.id}
              />
            </Panel>
          </div>

          <aside className="min-w-0 space-y-5">
            {selected?.parsed ? (
              <Panel title="Правила конкурса">
                <div className="space-y-3">
                  <RulesList parsed={selected.parsed} />
                  <p className="text-muted text-xs">
                    Участники: активных {entryCounts.active ?? 0}, ждут сброса демо {entryCounts.pending_reset ?? 0}, дисквалифицировано{' '}
                    {entryCounts.disqualified ?? 0}.
                  </p>
                </div>
              </Panel>
            ) : null}
            {selected && isAdmin && phase === 'finished' ? (
              <Panel title="Подвести итоги" description="Период закончился. Итоговый снимок + призы в очередь начислений.">
                <FinalizeForm id={selected.id} winners={prizes.length} prizesMinor={prizes.reduce((s, x) => s + (x.prizeMinor ?? 0), 0)} />
              </Panel>
            ) : null}
            {selected && phase === 'running' ? (
              <Callout tone="info" title="Конкурс идёт">
                Итоги подводятся после {selected.endsAt ? fmtDateTime(selected.endsAt) : 'окончания'}; до тех пор лидерборд живой.
              </Callout>
            ) : null}
            {final ? (
              <Callout tone="positive" title="Итоги подведены">
                Призы — в очереди начислений; деньги уходят после одобрения.{' '}
                <Link href="/promo/queue" className="text-accent hover:underline">
                  Очередь →
                </Link>
              </Callout>
            ) : null}
          </aside>
        </div>
      )}
    </div>
  );
}
