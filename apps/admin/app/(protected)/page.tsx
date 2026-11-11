import Link from 'next/link';
import {
  DataTable,
  EmptyState,
  KpiTile,
  Money,
  PageHeader,
  Panel,
  StatusBadge,
  Timeline,
  type DataTableColumn,
} from '@broker/ui';
import { listPendingClients, type PendingClient } from '@/lib/kyc/queries';
import { requireSection } from '@/lib/auth/section-guard';
import { canAccessSection } from '@/components/shell/sections';
import { canOperateMoney } from '@/lib/crypto/runtime';
import {
  getClientsSummary,
  getMoneySummary,
  listPendingWithdrawals,
  listRecentActions,
  type PendingWithdrawal,
} from '@/lib/dashboard/queries';
import { actionLabel } from '@/lib/journal/labels';
import { fmtAge, fmtDateTime, fmtRelativeDay } from '@/lib/ui/format';
// ── Поддержка (ветка demo-support) ──
import { queueStats } from '@broker/support';
import { getPool } from '@/lib/db';
import { supportActor } from '@/lib/support/runtime';
// ── Менеджеры клиентов (ветка admin-managers) ──
import { getMyClientsSummary, isClientManager, listMyClients } from '@/lib/managers/queries';
import { MyClientsKpis, MyClientsPanel } from './_managers/MyClientsSection';
// ── Учётные данные клиента (ветка admin-credentials) ──
import { getCredentialsAlerts } from '@/lib/credentials/queries';
import { moneyPool } from '@/lib/crypto/runtime';

/**
 * Дашборд `/` (эталонный экран редизайна, концепция §7.3). Операционный пульт,
 * не витрина: отвечает на «где меня ждут?» (очереди с возрастом старейшей
 * заявки) и «что произошло?» (последние действия журнала). Числа мгновенные и
 * точные, табличными цифрами, без анимации (§5.4).
 *
 * Только чтение: агрегаты `lib/dashboard/queries.ts`. Денежный блок — только
 * для ролей с доступом к деньгам (admin, finance_operator): для оператора его
 * нет вовсе — ни плиток, ни запроса (fail-closed, Р-394). Выдуманных чисел нет:
 * чего не знаем — того не показываем.
 */
export const dynamic = 'force-dynamic';

/** Старше этого — заявка KYC «просрочена» (подсветка возраста). */
const KYC_SLA_HOURS = 48;

function isOverdue(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() > KYC_SLA_HOURS * 3_600_000;
}

const KYC_COLUMNS: DataTableColumn<PendingClient>[] = [
  {
    key: 'client',
    header: 'Клиент',
    cell: (c) => (
      <Link href={`/kyc/${c.userId}`} className="group block min-w-0">
        <span className="text-primary group-hover:text-accent block truncate font-medium">
          {c.fullName}
        </span>
        <span className="text-muted block truncate text-xs">{c.email}</span>
      </Link>
    ),
  },
  { key: 'docs', header: 'Документы', numeric: true, width: '7rem', cell: (c) => c.documentCount },
  {
    key: 'age',
    header: 'В очереди',
    numeric: true,
    width: '8rem',
    cell: (c) => (
      <span className={isOverdue(c.updatedAt) ? 'text-warning font-medium' : undefined}>
        {fmtAge(c.updatedAt)}
      </span>
    ),
  },
  { key: 'state', header: 'Статус', width: '9rem', cell: () => <StatusBadge status="pending" /> },
  {
    key: 'go',
    header: <span className="sr-only">Действие</span>,
    width: '7rem',
    align: 'right',
    cell: (c) => (
      <Link
        href={`/kyc/${c.userId}`}
        className="text-accent text-[13px] font-medium hover:underline"
      >
        Проверить
      </Link>
    ),
  },
];

const WITHDRAWAL_COLUMNS: DataTableColumn<PendingWithdrawal>[] = [
  {
    key: 'client',
    header: 'Клиент',
    cell: (w) => (
      <Link
        href={`/clients/${w.userId}?tab=money`}
        className="text-primary hover:text-accent truncate font-medium"
      >
        {w.fullName}
      </Link>
    ),
  },
  {
    key: 'amount',
    header: 'Сумма',
    numeric: true,
    width: '10rem',
    cell: (w) => <Money minor={w.amountMinor} currency="USDT" />,
  },
  {
    key: 'status',
    header: 'Статус',
    width: '9rem',
    cell: (w) => (
      <StatusBadge
        status={w.status === 'needs_review' ? 'withdrawal_needs_review' : 'withdrawal_requested'}
      />
    ),
  },
  { key: 'age', header: 'Ждёт', numeric: true, width: '7rem', cell: (w) => fmtAge(w.requestedAt) },
];

function OpenLink({ href, children = 'Открыть →' }: { href: string; children?: React.ReactNode }) {
  return (
    <Link href={href} className="text-accent font-medium hover:underline">
      {children}
    </Link>
  );
}

export default async function ControlCenterHome() {
  // Дашборд — по матрице разделов; support_operator уводится на «Поддержку».
  const operator = await requireSection('dashboard');
  const money = canOperateMoney(operator.role);
  // KYC/AML-плитки и очередь — только ролям этих разделов (finance_operator их не видит).
  const kyc = canAccessSection(operator.role, 'kyc');
  const aml = canAccessSection(operator.role, 'aml');

  const [pending, clients, recent, moneySummary, withdrawals] = await Promise.all([
    kyc ? listPendingClients() : Promise.resolve([] as Awaited<ReturnType<typeof listPendingClients>>),
    getClientsSummary(),
    listRecentActions(9),
    money ? getMoneySummary() : Promise.resolve(null),
    money ? listPendingWithdrawals(5) : Promise.resolve([] as PendingWithdrawal[]),
  ]);
  // Очередь отсортирована по возрастанию updated_at → старейшая первая.
  // ── Поддержка (ветка demo-support): та же видимость, что у очереди (по роли). ──
  const supportActorNow = await supportActor();
  const support = supportActorNow ? await queueStats(getPool(), supportActorNow) : null;
  // ── Менеджер клиентов: свой портфель — первым блоком («где меня ждут»). ──
  const manager = await isClientManager(operator.operatorId).catch(() => false);
  const [mySummary, myClients] = manager
    ? await Promise.all([getMyClientsSummary(operator.operatorId), listMyClients(operator.operatorId, 8)])
    : [null, []];
  // ── Сигнал службе безопасности (только admin): правки учётных данных за сутки
  //    и операторы сверх порога. Информационно — ничего не блокирует. ──
  const credAlerts = operator.role === 'admin' ? await getCredentialsAlerts(moneyPool()).catch(() => null) : null;
  const oldest = pending[0];
  const overdue = pending.filter((p) => isOverdue(p.updatedAt)).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Дашборд"
        description="Где вас ждут и что произошло на платформе."
        meta={
          <span className="tabular-nums">
            Срез на {fmtDateTime(new Date())} · данные на момент открытия страницы
          </span>
        }
      />

      {mySummary ? <MyClientsKpis summary={mySummary} /> : null}

      <section aria-label="Комплаенс и клиенты" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kyc ? (
        <KpiTile
          label="KYC ждут решения"
          value={pending.length}
          tone={pending.length > 0 ? 'warning' : 'default'}
          hint={
            oldest
              ? `старейшая ${fmtAge(oldest.updatedAt)}${overdue ? ` · просрочено ${overdue}` : ''}`
              : 'очередь пуста'
          }
          action={<OpenLink href="/kyc" />}
        />
        ) : null}
        {aml ? (
        <KpiTile
          label="AML: эскалации"
          value={clients.amlEscalated}
          tone={clients.amlEscalated > 0 ? 'negative' : 'default'}
          hint={`не сверялись: ${clients.amlUnscreened}`}
          action={<OpenLink href="/aml" />}
        />
        ) : null}
        <KpiTile
          label="Клиенты"
          value={clients.total}
          hint={`подтверждены ${clients.verified} · новые за 7 дн ${clients.newLast7d}`}
          action={<OpenLink href="/clients" />}
        />
        <KpiTile
          label="Заблокированы"
          value={clients.blocked}
          tone={clients.blocked > 0 ? 'negative' : 'default'}
          hint="вход в кабинет и терминал закрыт"
          action={<OpenLink href="/clients" />}
        />
      </section>

      {credAlerts ? (
        <section aria-label="Правки учётных данных" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiTile
            label="Правки учётных данных за 24 ч"
            value={credAlerts.risky24h}
            hint={`email, пароль, адрес, снятие заморозки · всего с заморозками ${credAlerts.total24h}`}
            action={<OpenLink href={`/journal?action=${encodeURIComponent('client.credentials.*')}`} />}
          />
          <KpiTile
            label="Необычная активность"
            value={credAlerts.unusual.length}
            tone={credAlerts.unusual.length > 0 ? 'negative' : 'default'}
            hint={
              credAlerts.unusual.length > 0
                ? credAlerts.unusual.map((u) => `${u.operatorName}: ${u.count}`).join(' · ')
                : `никто не превысил ${credAlerts.threshold} правок за сутки`
            }
            action={
              credAlerts.unusual[0] ? (
                <OpenLink
                  href={`/journal?action=${encodeURIComponent('client.credentials.*')}&operatorId=${credAlerts.unusual[0].operatorId}`}
                />
              ) : (
                <OpenLink href="/settings#credentials">Порог →</OpenLink>
              )
            }
          />
        </section>
      ) : null}

      {support ? (
        <section aria-label="Поддержка" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiTile
            label="Поддержка: ждут ответа"
            value={support.awaiting}
            tone={support.awaiting > 0 ? 'warning' : 'default'}
            hint={support.oldestAwaitingAt ? `старейшее ${fmtAge(support.oldestAwaitingAt)}` : 'очередь пуста'}
            action={<OpenLink href="/support" />}
          />
          <KpiTile
            label="Поддержка: SLA просрочен"
            value={support.overdue}
            tone={support.overdue > 0 ? 'negative' : 'default'}
            hint="первый ответ в рабочие часы"
            action={<OpenLink href="/support" />}
          />
          <KpiTile
            label="Поддержка: не назначены"
            value={support.unassigned}
            tone={support.unassigned > 0 ? 'warning' : 'default'}
            hint={`ждём клиента / эскалация: ${support.waiting}`}
            action={<OpenLink href="/support?f=unassigned" />}
          />
          <KpiTile
            label="Поддержка: решено за 24 ч"
            value={support.resolvedToday}
            hint={support.csatAvg !== null ? `оценка ${support.csatAvg.toFixed(1).replace('.', ',')} из 5` : 'оценок пока нет'}
          />
        </section>
      ) : null}

      {moneySummary ? (
        <section aria-label="Деньги" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiTile
            label="Выводы ждут решения"
            value={moneySummary.withdrawalsPending}
            tone={moneySummary.withdrawalsPending > 0 ? 'warning' : 'default'}
            hint={
              <>
                <Money minor={moneySummary.withdrawalsPendingMinor} currency="USDT" /> · на проверке{' '}
                {moneySummary.needsReview}
              </>
            }
            action={<OpenLink href="/money" />}
          />
          <KpiTile
            label="Неопознанные поступления"
            value={moneySummary.unidentified}
            tone={moneySummary.unidentified > 0 ? 'warning' : 'default'}
            hint={<Money minor={moneySummary.unidentifiedMinor} currency="USDT" />}
            action={<OpenLink href="/money?tab=unidentified" />}
          />
          <KpiTile
            label="Зачислено за 7 дней"
            value={<Money minor={moneySummary.depositsCredited7dMinor} currency="USDT" />}
            hint="депозиты USDT TRC20, статус «зачислен»"
          />
          <KpiTile
            label="Выведено за 7 дней"
            value={<Money minor={moneySummary.withdrawalsSettled7dMinor} currency="USDT" />}
            hint="выводы со статусом «исполнена»"
          />
        </section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          {mySummary ? <MyClientsPanel rows={myClients} total={mySummary.total} /> : null}

          {kyc ? (
          <Panel
            title="Очередь верификации"
            count={pending.length}
            description={`Старейшие сверху. Дольше ${KYC_SLA_HOURS} ч — подсвечено.`}
            actions={<OpenLink href="/kyc">Вся очередь →</OpenLink>}
            flush
          >
            <DataTable
              bare
              aria-label="Клиенты, ожидающие решения KYC"
              columns={KYC_COLUMNS}
              rows={pending.slice(0, 8)}
              rowKey={(c) => c.userId}
              rowTone={(c) => (isOverdue(c.updatedAt) ? 'warning' : undefined)}
              empty={
                <EmptyState
                  size="compact"
                  title="Очередь пуста"
                  description="Клиентов, ожидающих проверки документов, нет."
                />
              }
            />
          </Panel>
          ) : null}

          {money ? (
            <Panel
              title="Выводы ждут решения"
              count={moneySummary?.withdrawalsPending ?? 0}
              description="Подана или на ручной проверке. Решение — в разделе «Деньги», с основанием."
              actions={<OpenLink href="/money">Раздел «Деньги» →</OpenLink>}
              flush
            >
              <DataTable
                bare
                aria-label="Выводы, ждущие решения"
                columns={WITHDRAWAL_COLUMNS}
                rows={withdrawals}
                rowKey={(w) => w.id}
                rowTone={(w) => (w.status === 'needs_review' ? 'warning' : undefined)}
                empty={<EmptyState size="compact" title="Нет выводов, ждущих решения" />}
              />
            </Panel>
          ) : null}
        </div>

        <Panel
          title="Последние действия"
          description="Неизменяемый журнал, новые сверху"
          actions={<OpenLink href="/journal">Журнал →</OpenLink>}
          className="self-start"
        >
          {recent.length === 0 ? (
            <EmptyState size="compact" title="Журнал пока пуст" />
          ) : (
            <Timeline
              items={recent.map((e) => {
                const a = actionLabel(e.action);
                return {
                  key: String(e.seq),
                  tone: a.tone,
                  title:
                    e.subjectKind === 'client' && e.subjectName ? (
                      <>
                        {a.label}
                        <span className="text-secondary font-normal"> · </span>
                        <Link
                          href={`/clients/${e.subjectId}`}
                          className="text-secondary hover:text-accent font-normal"
                        >
                          {e.subjectName}
                        </Link>
                      </>
                    ) : (
                      a.label
                    ),
                  time: fmtRelativeDay(e.occurredAt),
                  meta: (
                    <>
                      {e.operatorName ?? '—'} · <span className="tabular-nums">seq {e.seq}</span>
                    </>
                  ),
                  body: e.basis ? <span className="line-clamp-2">{e.basis}</span> : undefined,
                };
              })}
            />
          )}
        </Panel>
      </div>
    </div>
  );
}
