import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Callout,
  DataTable,
  DescriptionList,
  EmptyState,
  KpiTile,
  Mono,
  Money,
  Panel,
  type DataTableColumn,
} from '@broker/ui';
import { getOperatorSession } from '@/lib/auth/current';
import { REWARD_KIND, REWARD_STATUS } from '@/lib/promo/labels';
import { getPromoSettings, getReward, listRewards, namesOf, queueCounts, type RewardRow } from '@/lib/promo/queries';
import { canViewPromo } from '@/lib/promo/runtime';
import { fmtAge, fmtDateTime } from '@/lib/ui/format';
import { DecisionArea } from '../../_money/ActionForm';
import { Segmented } from '../../_money/Segmented';
import { PromoHeader } from '../_components/PromoHeader';
import { RewardActions } from '../_components/PromoForms';
import { RewardStatusBadge, SignalBadges, SignalDetails } from '../_components/badges';

/**
 * Очередь начислений (концепция §7.4): слева — старейшие сверху, справа —
 * панель решения (`?r=<id>`): сумма, получатель, основание расчёта, сигналы
 * связанности со ссылками на связанных клиентов, одобрить / отклонить /
 * повторить. Решают admin и finance_operator; каждое решение — с основанием.
 */
export const dynamic = 'force-dynamic';

type Filter = 'open' | 'closed' | 'all';
const asFilter = (v?: string): Filter => (v === 'closed' || v === 'all' ? v : 'open');
const href = (f: Filter, r?: string) => {
  const q = new URLSearchParams();
  if (f !== 'open') q.set('f', f);
  if (r) q.set('r', r);
  const s = q.toString();
  return `/promo/queue${s ? `?${s}` : ''}`;
};
const isOpen = (s: string) => s === 'pending' || s === 'approved' || s === 'needs_review';

function source(r: RewardRow) {
  if (r.kind === 'ib') return r.ibPartnerName ? `IB · ${r.ibPartnerName}` : 'IB-партнёр';
  return r.promotionTitle ?? '—';
}

function columns(filter: Filter, selected?: string): DataTableColumn<RewardRow>[] {
  return [
    {
      key: 'client',
      header: 'Получатель · за что',
      cell: (r) => (
        <span className="block min-w-0">
          <Link
            href={`${href(filter, r.id)}#decision`}
            scroll={false}
            aria-current={r.id === selected ? 'true' : undefined}
            className="text-primary hover:text-accent block truncate font-medium"
          >
            {r.clientName}
          </Link>
          <span className="text-muted block truncate text-xs">
            {REWARD_KIND[r.kind] ?? r.kind}
            {r.period ? ` · ${r.period}` : ''} · {source(r)}
          </span>
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Сумма, USDT',
      numeric: true,
      width: '7rem',
      cell: (r) => <Money minor={r.amountMinor} currency="USDT" hideCurrency className={r.status === 'rejected' ? 'text-muted line-through' : 'font-medium'} />,
    },
    { key: 'signals', header: 'Сигналы', cell: (r) => <SignalBadges signals={r.signals} /> },
    {
      key: 'status',
      header: 'Статус',
      width: '9rem',
      cell: (r) => (
        <span className="inline-flex flex-col gap-0.5">
          <RewardStatusBadge status={r.status} />
          <span className="text-muted text-xs tabular-nums" title={fmtDateTime(r.createdAt)}>
            {isOpen(r.status) ? `ждёт ${fmtAge(r.createdAt)}` : fmtDateTime(r.createdAt)}
          </span>
        </span>
      ),
    },
  ];
}

const BASIS_LABELS: Record<string, string> = {
  promotion: 'Акция',
  percentBps: 'Процент, б.п.',
  capMinor: 'Потолок, центы',
  baseDepositMinor: 'Депозит-основание, центы',
  role: 'Роль',
  period: 'Период',
  feesMinor: 'Наценка + комиссия, центы',
  place: 'Место',
  returnBps: 'Доходность, б.п.',
  tradesCount: 'Сделок',
  model: 'Модель',
  revenueMinor: 'Доход платформы, центы',
};

export default async function QueuePage({ searchParams }: { searchParams: { f?: string; r?: string } }) {
  const operator = await getOperatorSession();
  if (!canViewPromo(operator?.role)) notFound();
  const filter = asFilter(searchParams.f);
  const [rows, settings, counts, selected] = await Promise.all([
    listRewards({ status: filter }),
    getPromoSettings(),
    queueCounts(),
    searchParams.r ? getReward(searchParams.r) : Promise.resolve(null),
  ]);
  const names = await namesOf([...new Set((selected?.signals ?? []).map((s) => s.withUserId).filter((x): x is string => !!x))]);
  const linked = rows.filter((r) => r.status === 'pending' && r.signals.some((s) => s.kind !== 'budget_insufficient')).length;

  return (
    <div className="space-y-6">
      <PromoHeader active="queue" settings={settings} queueCount={counts.pending} />

      <section aria-label="Очередь" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile
          label="Ждут решения"
          value={counts.pending}
          tone={counts.pending > 0 ? 'warning' : 'default'}
          hint={counts.pending > 0 ? <><Money minor={counts.pendingMinor} currency="USDT" />{counts.oldest ? ` · старейшее ${fmtAge(counts.oldest)}` : ''}</> : 'очередь пуста'}
        />
        <KpiTile label="Со связями" value={linked} tone={linked > 0 ? 'negative' : 'default'} hint="общий кошелёк / адрес / IP / самореферал" />
        <KpiTile label="Зачисляются / отказ терминала" value={counts.review} tone={counts.review > 0 ? 'warning' : 'default'} hint="нужен повтор или разбор" />
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel
          title="Начисления"
          count={rows.length}
          flush
          actions={
            <Segmented
              items={[
                { key: 'open', label: 'Открытые', href: href('open') },
                { key: 'closed', label: 'Закрытые', href: href('closed') },
                { key: 'all', label: 'Все', href: href('all') },
              ]}
              active={filter}
              label="Фильтр очереди"
            />
          }
        >
          <DataTable
            bare
            columns={columns(filter, selected?.id)}
            rows={rows}
            rowKey={(r) => r.id}
            selectedKey={selected?.id}
            rowTone={(r) => (r.status === 'pending' && r.signals.some((s) => s.kind === 'self_referral') ? 'negative' : isOpen(r.status) ? 'warning' : undefined)}
            empty={<EmptyState size="compact" title={filter === 'open' ? 'Очередь пуста' : 'Ничего не найдено'} description="Начисления появляются, когда клиенты выполняют условия акций (кнопка «Пересчитать» в карточке акции)." />}
          />
        </Panel>

        <aside id="decision" className="min-w-0 space-y-5 xl:sticky xl:top-20">
          {selected ? (
            <Panel title="Решение по начислению" actions={<RewardStatusBadge status={selected.status} />}>
              <div className="space-y-4">
                <div>
                  <p className="text-muted text-xs">Сумма на реальный счёт</p>
                  <Money minor={selected.amountMinor} currency="USDT" className={selected.status === 'rejected' ? 'text-muted text-2xl font-semibold line-through' : 'text-2xl font-semibold'} />
                </div>
                <DescriptionList
                  columns={1}
                  items={[
                    {
                      term: 'Получатель',
                      value: (
                        <Link href={`/clients/${selected.userId}`} className="text-accent hover:underline">
                          {selected.clientName}
                        </Link>
                      ),
                      hint: selected.clientEmail,
                    },
                    ...(selected.relatedUserId
                      ? [
                          {
                            term: selected.kind === 'ib' ? 'Привлечённый клиент' : 'Пара (реферер ↔ друг)',
                            value: (
                              <Link href={`/clients/${selected.relatedUserId}`} className="text-accent hover:underline">
                                {selected.relatedName ?? selected.relatedUserId}
                              </Link>
                            ),
                            hint: selected.relatedEmail ?? undefined,
                          },
                        ]
                      : []),
                    { term: 'За что', value: `${REWARD_KIND[selected.kind] ?? selected.kind} · ${source(selected)}` },
                    { term: 'Операция в терминале', value: <Mono value={selected.externalRef} middle={14} className="text-[13px]" /> },
                    ...(selected.budgetMinor !== null
                      ? [{ term: 'Бюджет акции', value: <><Money minor={selected.spentMinor} currency="USDT" /> из <Money minor={selected.budgetMinor} currency="USDT" /></>, hint: 'одобрено / всего' }]
                      : []),
                  ]}
                />
                <div className="border-border space-y-2 border-t pt-4">
                  <p className="text-primary text-[13px] font-semibold">Сигналы связанности</p>
                  <SignalDetails signals={selected.signals} names={names} />
                  {selected.signals.length > 0 ? (
                    <p className="text-muted text-xs">Подсказки, не автоматический отказ: решает оператор, решение — в журнал.</p>
                  ) : null}
                </div>
                <details className="border-border border-t pt-4">
                  <summary className="text-primary cursor-pointer text-[13px] font-semibold">Основание расчёта</summary>
                  <dl className="mt-2 space-y-1 text-xs">
                    {Object.entries(selected.basis).map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <dt className="text-muted w-40 shrink-0">{BASIS_LABELS[k] ?? k}</dt>
                        <dd className="text-secondary min-w-0 break-all font-mono">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
                {selected.status !== 'pending' ? (
                  <DescriptionList
                    columns={1}
                    items={[
                      { term: 'Решил', value: selected.decidedBy ?? '—', hint: selected.decidedAt ? fmtDateTime(selected.decidedAt) : undefined },
                      ...(selected.decisionReason ? [{ term: 'Основание', value: selected.decisionReason }] : []),
                      ...(selected.checkNote ? [{ term: 'Терминал', value: selected.checkNote, tone: 'warning' as const }] : []),
                      ...(selected.terminalSeq !== null ? [{ term: 'Проводка терминала', value: `seq ${selected.terminalSeq}` }] : []),
                    ]}
                  />
                ) : null}
                {!settings?.promotionsEnabled && selected.status === 'pending' ? (
                  <Callout tone="warning">Акции выключены на платформе. Начисление заработано до выключения — решение за вами.</Callout>
                ) : null}
                <div className="border-border border-t pt-4">
                  <DecisionArea key={selected.id}>
                    <RewardActions
                      r={{
                        id: selected.id,
                        status: selected.status,
                        amountMinor: selected.amountMinor,
                        clientName: selected.clientName,
                        clientEmail: selected.clientEmail,
                        kindLabel: REWARD_KIND[selected.kind] ?? selected.kind,
                        externalRef: selected.externalRef,
                        hasSignals: selected.signals.length > 0,
                        budgetLeftMinor: selected.budgetMinor !== null && selected.spentMinor !== null ? selected.budgetMinor - selected.spentMinor : null,
                      }}
                    />
                    {!isOpen(selected.status) ? (
                      <p className="text-muted text-[13px]">Начисление закрыто: {REWARD_STATUS[selected.status]?.label.toLowerCase()}.</p>
                    ) : null}
                  </DecisionArea>
                </div>
              </div>
            </Panel>
          ) : (
            <Panel title="Решение по начислению">
              <EmptyState size="compact" title="Выберите начисление" description="Откройте строку очереди: сумма, основание, сигналы связанности и формы решения появятся здесь." />
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}
