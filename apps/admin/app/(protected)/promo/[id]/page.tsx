import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Callout,
  DataTable,
  DescriptionList,
  EmptyState,
  KpiTile,
  Money,
  Panel,
  ToneBadge,
  type DataTableColumn,
} from '@broker/ui';
import { getOperatorSession } from '@/lib/auth/current';
import { formValuesFromRules, toLocalInput } from '@/lib/promo/form';
import { REWARD_KIND, TYPE_LABELS } from '@/lib/promo/labels';
import {
  getPromoSettings,
  getPromotion,
  listParticipants,
  listRewards,
  queueCounts,
  type ParticipantRow,
  type RewardRow,
} from '@/lib/promo/queries';
import { canManagePromo, canViewPromo } from '@/lib/promo/runtime';
import { fmtDate, fmtDateTime } from '@/lib/ui/format';
import { PromoHeader } from '../_components/PromoHeader';
import { PromotionForm } from '../_components/PromotionForm';
import { CashbackForm, StatusForms, SyncForm } from '../_components/PromoForms';
import { RulesList } from '../_components/RulesList';
import { REAL_ACCOUNT_CURRENCY } from '@broker/money';
import {
  ConditionList,
  ParticipationBadge,
  PromoStatusBadge,
  RewardStatusBadge,
  SignalBadges,
} from '../_components/badges';

/**
 * Карточка акции (концепция §7.2): правила, бюджет, участники с прогрессом,
 * начисления акции; справа — статус, пересчёт, кешбэк за период. Изменение
 * условий — `?edit=1`, только черновик/пауза, только admin.
 */
export const dynamic = 'force-dynamic';

const partColumns: DataTableColumn<ParticipantRow>[] = [
  {
    key: 'client',
    header: 'Клиент',
    cell: (p) => (
      <Link href={`/clients/${p.userId}`} className="group block min-w-0">
        <span className="text-primary group-hover:text-accent block truncate font-medium">{p.clientName}</span>
        <span className="text-muted block truncate text-xs">вступил {fmtDate(p.enrolledAt)}</span>
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Статус',
    width: '9rem',
    cell: (p) => (
      <span className="inline-flex flex-col gap-0.5">
        <ParticipationBadge status={p.status} />
        {typeof p.progress.reason === 'string' ? (
          <span className="text-muted text-xs">{EVAL_REASON[p.progress.reason] ?? p.progress.reason}</span>
        ) : null}
      </span>
    ),
  },
  {
    key: 'progress',
    header: 'Условия',
    cell: (p) => (
      <ConditionList
        compact
        conditions={Array.isArray(p.progress.conditions) ? (p.progress.conditions as { key: string; met: boolean }[]) : []}
      />
    ),
  },
  {
    key: 'reward',
    header: 'Награда, USDT',
    numeric: true,
    width: '8rem',
    cell: (p) =>
      typeof p.progress.rewardMinor === 'number' ? (
        <Money minor={p.progress.rewardMinor} currency={REAL_ACCOUNT_CURRENCY} hideCurrency />
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  {
    key: 'deadline',
    header: 'Срок до',
    numeric: true,
    width: '7.5rem',
    cell: (p) => (typeof p.progress.deadline === 'string' ? fmtDate(p.progress.deadline) : <span className="text-muted">—</span>),
  },
];

const EVAL_REASON: Record<string, string> = {
  withdrawal: 'вывод до выплаты',
  window: 'срок истёк',
  deposit_before_start: 'депозит до старта акции',
  below_minimum: 'первый депозит меньше минимума',
};

const rewardColumns: DataTableColumn<RewardRow>[] = [
  {
    key: 'client',
    header: 'Получатель',
    cell: (r) => (
      <Link href={`/promo/queue?r=${r.id}`} className="group block min-w-0">
        <span className="text-primary group-hover:text-accent block truncate font-medium">{r.clientName}</span>
        <span className="text-muted block truncate text-xs">{REWARD_KIND[r.kind] ?? r.kind}{r.period ? ` · ${r.period}` : ''}</span>
      </Link>
    ),
  },
  {
    key: 'amount',
    header: 'Сумма, USDT',
    numeric: true,
    width: '8rem',
    cell: (r) => <Money minor={r.amountMinor} currency={REAL_ACCOUNT_CURRENCY} hideCurrency className={r.status === 'rejected' ? 'text-muted line-through' : 'font-medium'} />,
  },
  { key: 'status', header: 'Статус', width: '9rem', cell: (r) => <RewardStatusBadge status={r.status} /> },
  { key: 'signals', header: 'Связи', cell: (r) => <SignalBadges signals={r.signals} /> },
];

export default async function PromotionCardPage({ params, searchParams }: { params: { id: string }; searchParams: { edit?: string } }) {
  const operator = await getOperatorSession();
  if (!canViewPromo(operator?.role)) notFound();
  const isAdmin = canManagePromo(operator?.role);
  const promo = await getPromotion(params.id);
  if (!promo) notFound();
  const [settings, participants, rewards, counts] = await Promise.all([
    getPromoSettings(),
    listParticipants(promo.id),
    listRewards({ promotionId: promo.id, status: 'all' }),
    queueCounts(),
  ]);
  const editable = isAdmin && (promo.status === 'draft' || promo.status === 'paused');
  const editing = editable && searchParams.edit === '1';
  const pending = rewards.filter((r) => r.status === 'pending');
  const credited = rewards.filter((r) => r.status === 'credited').reduce((s, r) => s + r.amountMinor, 0);
  const ru = promo.texts.ru ?? Object.values(promo.texts)[0];

  return (
    <div className="space-y-6">
      <PromoHeader
        active={null}
        settings={settings}
        queueCount={counts.pending}
        title={promo.title}
        description={`${TYPE_LABELS[promo.type] ?? promo.type} · код ${promo.slug}`}
        breadcrumbs={[{ label: 'Акции и партнёры', href: '/promo' }, { label: promo.title }]}
        actions={
          <span className="flex items-center gap-2">
            <PromoStatusBadge status={promo.status} />
            {editable && !editing ? (
              <Link
                href={`/promo/${promo.id}?edit=1#edit`}
                className="border-border-strong text-primary hover:bg-primary/[0.04] inline-flex h-9 items-center rounded-md border px-3.5 text-sm"
              >
                Изменить условия
              </Link>
            ) : null}
            {promo.type === 'contest' ? (
              <Link
                href={`/promo/contests?c=${promo.id}`}
                className="border-border-strong text-primary hover:bg-primary/[0.04] inline-flex h-9 items-center rounded-md border px-3.5 text-sm"
              >
                Лидерборд →
              </Link>
            ) : null}
          </span>
        }
      />

      {!promo.parsed ? (
        <Callout tone="negative" title="Правила акции испорчены">
          {promo.ruleIssues.join('; ')} — движок эту акцию не считает. Поставьте на паузу и исправьте условия.
        </Callout>
      ) : null}

      <section aria-label="Сводка акции" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Бюджет одобрен" value={<Money minor={promo.spentMinor} currency={REAL_ACCOUNT_CURRENCY} />} hint={<>из <Money minor={promo.budgetMinor} currency={REAL_ACCOUNT_CURRENCY} /> · {promo.budgetMinor > 0 ? Math.round((promo.spentMinor / promo.budgetMinor) * 100) : 0} %</>} />
        <KpiTile label="Участники" value={promo.type === 'contest' ? '—' : participants.length} hint={promo.type === 'contest' ? 'см. лидерборд' : `выполнили: ${participants.filter((p) => p.status === 'qualified' || p.status === 'rewarded').length}`} />
        <KpiTile
          label="Ждут решения"
          value={pending.length}
          tone={pending.length > 0 ? 'warning' : 'default'}
          hint={pending.length > 0 ? <Money minor={pending.reduce((s, r) => s + r.amountMinor, 0)} currency={REAL_ACCOUNT_CURRENCY} /> : 'нет'}
          action={
            pending.length > 0 ? (
              <Link href="/promo/queue" className="text-accent font-medium hover:underline">
                Очередь →
              </Link>
            ) : undefined
          }
        />
        <KpiTile label="Зачислено" value={<Money minor={credited} currency={REAL_ACCOUNT_CURRENCY} />} hint="через терминал" />
      </section>

      {editing ? (
        <div id="edit">
          <Panel title="Изменить условия" description="Только черновик или пауза. Изменение — с основанием, в журнал пишется что было и что стало." actions={<Link href={`/promo/${promo.id}`} className="text-accent text-[13px] font-medium hover:underline">Закрыть</Link>}>
            <PromotionForm
              initial={{
                id: promo.id,
                type: promo.type,
                slug: promo.slug,
                title: promo.title,
                cmsPromoId: promo.cmsPromoId ?? '',
                startsAt: toLocalInput(promo.startsAt),
                endsAt: toLocalInput(promo.endsAt),
                budget: (promo.budgetMinor / 100).toFixed(2),
                countriesAllow: promo.countriesAllow.join(', '),
                countriesDeny: promo.countriesDeny.join(', '),
                texts: promo.texts,
                rules: formValuesFromRules(promo.type, promo.rulesRaw),
              }}
            />
          </Panel>
        </div>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Panel title="Условия" description="Из базы акции — кабинет и движок читают их же.">
            <div className="space-y-4">
              {promo.parsed ? <RulesList parsed={promo.parsed} /> : null}
              <div className="border-border border-t pt-4">
                <DescriptionList
                  columns={3}
                  items={[
                    { term: 'Период', value: promo.startsAt || promo.endsAt ? `${promo.startsAt ? fmtDateTime(promo.startsAt) : '…'} — ${promo.endsAt ? fmtDateTime(promo.endsAt) : '…'}` : 'бессрочно' },
                    { term: 'Только для стран', value: promo.countriesAllow.length ? promo.countriesAllow.join(', ') : 'все' },
                    { term: 'Кроме стран', value: promo.countriesDeny.length ? promo.countriesDeny.join(', ') : 'нет' },
                  ]}
                />
              </div>
            </div>
          </Panel>

          {promo.type !== 'contest' ? (
            <Panel title="Участники" count={participants.length} flush>
              <DataTable
                bare
                columns={partColumns}
                rows={participants}
                rowKey={(p) => p.id}
                rowTone={(p) => (p.status === 'qualified' ? 'warning' : undefined)}
                empty={
                  <EmptyState
                    size="compact"
                    title="Участников нет"
                    description={promo.type === 'referral' ? 'Друзья появятся после регистрации по реф-ссылке и пересчёта очереди.' : 'Клиенты вступают в акцию в кабинете кнопкой «Участвовать».'}
                  />
                }
              />
            </Panel>
          ) : null}

          <Panel title="Начисления акции" count={rewards.length} flush>
            <DataTable
              bare
              columns={rewardColumns}
              rows={rewards}
              rowKey={(r) => r.id}
              rowTone={(r) => (r.status === 'pending' || r.status === 'needs_review' ? 'warning' : undefined)}
              empty={<EmptyState size="compact" title="Начислений пока нет" description="Они появятся, когда участники выполнят условия и очередь будет пересчитана." />}
            />
          </Panel>
        </div>

        <aside className="min-w-0 space-y-5">
          {isAdmin ? (
            <Panel title="Статус акции" actions={<PromoStatusBadge status={promo.status} />}>
              <StatusForms id={promo.id} status={promo.status} />
            </Panel>
          ) : null}
          {promo.type === 'deposit_bonus' || promo.type === 'referral' ? (
            <Panel title="Пересчёт очереди" description="Оценка участников по фактам → выполнившие условия встают в очередь.">
              <SyncForm id={promo.id} />
            </Panel>
          ) : null}
          {promo.type === 'cashback' && isAdmin ? (
            <Panel title="Кешбэк за месяц" description="Процент от уплаченных участниками наценки и комиссии.">
              <CashbackForm id={promo.id} />
            </Panel>
          ) : null}
          <Panel title="Текст для клиента" actions={ru ? <ToneBadge tone="neutral" plain>ru</ToneBadge> : null}>
            {ru ? (
              <div className="space-y-2 text-[13px]">
                <p className="text-primary font-medium">{ru.title}</p>
                {ru.summary ? <p className="text-secondary">{ru.summary}</p> : null}
                {ru.terms ? <p className="text-muted whitespace-pre-line text-xs">{ru.terms}</p> : null}
              </div>
            ) : (
              <p className="text-muted text-[13px]">Текстов нет — кабинет покажет название акции.</p>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
