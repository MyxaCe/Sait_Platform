import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getClientCard, type ClientJournalEntry } from '@/lib/clients/queries';
import { DOC_KIND_LABELS, STATE_LABELS } from '@/lib/clients/verification-state';
import { getOperatorSession } from '@/lib/auth/current';
import { VerificationBadge, BlockBadge } from '../_components/StatusBadge';
import { JournalFeed } from './_components/JournalFeed';
import { ViewDocumentButton } from './_components/ViewDocumentButton';
import { BlockPanel } from './_components/BlockPanel';
import { TradingSection, type LiveAccount } from './_components/TradingSection';
import { MoneyFlagsPanel } from './_components/MoneyFlagsPanel';
import { getClientTrading } from '@/lib/clients/trading';
import { loadMoneyPolicyInputs, computeMoneyPolicy, type MoneyPolicy } from '@broker/money';
import { canOperateMoney, moneyPool, terminalReader } from '@/lib/crypto/runtime';
import { listClientDeposits, listClientWithdrawals } from '@/lib/crypto/queries';
import {
  centsText,
  DEPOSIT_REJECT,
  DEPOSIT_STATUS,
  POLICY_REASON,
  WITHDRAWAL_STATUS,
} from '@/lib/crypto/labels';

/**
 * Карточка клиента `/clients/[id]` (ADM-02, §3.2): досье — профиль, состояние
 * верификации с историей переходов, документы (с превью), активность, текущие
 * сессии, счёт и торговля (проекция терминала), журнальная лента по этому субъекту; блокировка/разблокировка и
 * «погасить сессии» (форма-с-основанием, danger-подтверждение).
 *
 * Роль-гейт (§3.2): просмотр — operator+admin (гейт layout/middleware);
 * блокировка — только admin (панель рендерится лишь для admin, fail-closed).
 */
export const dynamic = 'force-dynamic';

function dateFmt(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Переходы верификации — срез журнала по действиям `client.verification.*`. */
const VERIFICATION_ACTIONS: Record<string, string> = {
  'client.verification.verified': 'Подтверждён',
  'client.verification.rejected': 'Отклонён',
  'client.verification.resubmit_requested': 'Запрошена переподача',
};

function VerificationTimeline({ journal }: { journal: ClientJournalEntry[] }) {
  const transitions = journal.filter((e) => e.action in VERIFICATION_ACTIONS);
  if (transitions.length === 0) {
    return <p className="text-sm text-secondary">Переходов состояния пока не было.</p>;
  }
  return (
    <ol className="space-y-2 border-l border-border pl-4">
      {transitions.map((e) => (
        <li key={e.seq} className="relative">
          <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-accent" aria-hidden />
          <p className="text-sm text-primary">{VERIFICATION_ACTIONS[e.action]}</p>
          <p className="tabular-nums text-xs text-secondary">
            {dateFmt(e.occurredAt)} · {e.operatorName ?? '—'}
          </p>
        </li>
      ))}
    </ol>
  );
}

export default async function ClientCardPage({ params }: { params: { id: string } }) {
  const [card, operator] = await Promise.all([
    getClientCard(params.id),
    getOperatorSession(),
  ]);
  if (!card) notFound();
  // Проекция торговли — после проверки, что клиент есть (UUID уже валиден).
  // Демо и реальный счёт разделены (09.11): показываем раздельно.
  const [demo, real, policyInputs, live, deposits, withdrawals] = await Promise.all([
    getClientTrading(card.userId, undefined, 'demo'),
    getClientTrading(card.userId, undefined, 'real'),
    loadMoneyPolicyInputs(moneyPool(), card.userId),
    terminalReader()
      .accounts(card.userId)
      .catch(() => ({ state: 'unavailable' as const, reason: 'network' as const })),
    listClientDeposits(card.userId),
    listClientWithdrawals(card.userId),
  ]);
  const policy = computeMoneyPolicy(policyInputs);
  const liveOf = (kind: 'demo' | 'real'): LiveAccount | null => {
    if (live.state !== 'ok') return null;
    const a = live.accounts.find((x) => x.kind === kind);
    return a
      ? { equityMinor: a.equityMinor, freeMarginMinor: a.freeMarginMinor, tradingFrozen: a.tradingFrozen, opened: a.opened }
      : { equityMinor: null, freeMarginMinor: null, tradingFrozen: false, opened: false };
  };
  const canMoney = canOperateMoney(operator?.role);

  const isAdmin = operator?.role === 'admin';

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/clients" className="text-sm text-secondary hover:text-primary">
        ← к реестру
      </Link>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{card.fullName}</h1>
          <VerificationBadge state={card.state} />
          <BlockBadge blocked={card.block.blocked} />
        </div>
        <p className="text-sm text-secondary">{card.email}</p>
        <p className="tabular-nums text-xs text-secondary">
          id {card.userId} · язык {card.locale}
        </p>
      </div>

      {card.block.blocked ? (
        <div className="rounded border border-negative/40 bg-negative/10 px-4 py-3 text-sm">
          <p className="font-medium text-negative">Клиент заблокирован.</p>
          <p className="text-secondary">
            {card.block.reason ? `Основание: ${card.block.reason}. ` : ''}
            {card.block.updatedAt ? `Когда: ${dateFmt(card.block.updatedAt)}. ` : ''}
            {card.block.blockedByName ? `Кто: ${card.block.blockedByName}.` : ''}
          </p>
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Активность и профиль</h2>
        <dl className="grid grid-cols-1 gap-2 rounded border border-border bg-elevated px-4 py-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase text-secondary">Зарегистрирован</dt>
            <dd className="tabular-nums text-primary">{dateFmt(card.registeredAt)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-secondary">Последний вход</dt>
            <dd className="tabular-nums text-primary">
              {card.lastLoginAt ? dateFmt(card.lastLoginAt) : 'никогда'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-secondary">Email подтверждён</dt>
            <dd className="tabular-nums text-primary">
              {card.emailVerifiedAt ? dateFmt(card.emailVerifiedAt) : 'нет'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-secondary">Активных сессий</dt>
            <dd className="tabular-nums text-primary">{card.sessions.length}</dd>
          </div>
        </dl>
      </section>

      <TradingSection trading={real} title="Реальный счёт (USDT)" kind="real" live={liveOf('real')} />

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Ввод и вывод: итоговые правила</h2>
        <PolicySummary policy={policy} />
        {canMoney ? (
          <MoneyFlagsPanel
            userId={card.userId}
            flags={{
              depositKyc: policyInputs.flags.depositKyc,
              withdrawKyc: policyInputs.flags.withdrawKyc,
              frozen: policyInputs.flags.frozen,
              withdrawBanned: policyInputs.flags.withdrawBanned,
            }}
          />
        ) : null}
        <ClientMoneyHistory deposits={deposits} withdrawals={withdrawals} />
      </section>

      <TradingSection trading={demo} title="Демо-счёт" kind="demo" live={liveOf('demo')} />

      <section className="space-y-3">
        <h2 className="text-lg font-medium">
          Верификация: {STATE_LABELS[card.state]}
          {card.verificationUpdatedAt ? (
            <span className="ml-2 text-sm font-normal text-secondary">
              обновлено {dateFmt(card.verificationUpdatedAt)}
            </span>
          ) : null}
        </h2>
        <div className="rounded border border-border bg-elevated px-4 py-4">
          <VerificationTimeline journal={card.journal} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Документы</h2>
        {card.documents.length === 0 ? (
          <p className="rounded border border-border bg-elevated px-4 py-4 text-sm text-secondary">
            Документы не поданы.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded border border-border bg-elevated">
            {card.documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <span className="min-w-0">
                  <span className="block font-medium text-primary">{DOC_KIND_LABELS[d.kind]}</span>
                  <span className="block truncate text-xs text-secondary">
                    {d.storageKey}
                    {d.contentType ? ` · ${d.contentType}` : ''}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-4">
                  <span className="tabular-nums text-sm text-secondary">
                    подан {dateFmt(d.submittedAt)}
                  </span>
                  <ViewDocumentButton docId={d.id} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Текущие сессии</h2>
        {card.sessions.length === 0 ? (
          <p className="rounded border border-border bg-elevated px-4 py-4 text-sm text-secondary">
            Активных сессий нет.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded border border-border bg-elevated">
            {card.sessions.map((s) => (
              <li key={s.id} className="px-4 py-3 text-sm">
                <p className="text-primary">
                  {s.ip ?? 'ip неизвестен'}
                  <span className="ml-2 text-xs text-secondary">
                    {s.userAgent ?? 'user-agent неизвестен'}
                  </span>
                </p>
                <p className="tabular-nums text-xs text-secondary">
                  создана {dateFmt(s.createdAt)} · действует до {dateFmt(s.expiresAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isAdmin ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Блокировка и сессии</h2>
          <BlockPanel userId={card.userId} blocked={card.block.blocked} />
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Журнал действий по клиенту</h2>
        <JournalFeed entries={card.journal} />
      </section>
    </div>
  );
}

const SOURCE: Record<string, string> = { platform: 'из платформы', client: 'индивидуально' };

function PolicySummary({ policy }: { policy: MoneyPolicy }) {
  const row = (label: string, value: string, hint?: string, bad?: boolean) => (
    <div>
      <dt className="text-xs uppercase text-secondary">{label}</dt>
      <dd className={bad ? 'text-negative' : 'text-primary'}>
        {value}
        {hint ? <span className="ml-1 text-xs text-secondary">({hint})</span> : null}
      </dd>
    </div>
  );
  const reasons = (list: string[]) => list.map((r) => POLICY_REASON[r] ?? r).join(', ');
  return (
    <dl className="grid grid-cols-1 gap-2 rounded border border-border bg-elevated px-4 py-4 text-sm sm:grid-cols-2">
      {row(
        'Ввод',
        policy.depositAllowed ? 'разрешён' : `закрыт: ${reasons(policy.depositReasons)}`,
        undefined,
        !policy.depositAllowed,
      )}
      {row(
        'Вывод',
        policy.withdrawAllowed ? 'разрешён' : `закрыт: ${reasons(policy.withdrawReasons)}`,
        undefined,
        !policy.withdrawAllowed,
      )}
      {row('Ввод только после KYC', policy.depositKyc.required ? 'да' : 'нет', SOURCE[policy.depositKyc.source])}
      {row('Вывод только после KYC', policy.withdrawKyc.required ? 'да' : 'нет', SOURCE[policy.withdrawKyc.source])}
      {row('KYC', policy.kycVerified ? 'подтверждён' : 'не подтверждён')}
      {row('Заморозка счёта', policy.frozen ? 'ДА' : 'нет', 'индивидуально', policy.frozen)}
      {row('Запрет вывода', policy.withdrawBanned ? 'ДА' : 'нет', 'индивидуально', policy.withdrawBanned)}
      {row(
        'Торговля на реальном',
        policy.realTradingAllowed ? 'доступна' : 'закрыта',
        undefined,
        !policy.realTradingAllowed,
      )}
    </dl>
  );
}

function ClientMoneyHistory({
  deposits,
  withdrawals,
}: {
  deposits: Awaited<ReturnType<typeof listClientDeposits>>;
  withdrawals: Awaited<ReturnType<typeof listClientWithdrawals>>;
}) {
  if (deposits.length === 0 && withdrawals.length === 0) {
    return <p className="text-sm text-secondary">Заявок на ввод и вывод не было.</p>;
  }
  return (
    <ul className="divide-y divide-border rounded border border-border bg-elevated text-sm">
      {deposits.map((d) => (
        <li key={d.id} className="flex flex-wrap justify-between gap-2 px-4 py-2">
          <span>
            Ввод · {DEPOSIT_STATUS[d.status] ?? d.status}
            {d.rejectReason ? ` (${DEPOSIT_REJECT[d.rejectReason] ?? d.rejectReason})` : ''}
            <span className="ml-2 font-mono text-xs text-secondary">{d.txHash.slice(0, 12)}…</span>
          </span>
          <span className="tabular-nums">{centsText(d.amountMinor)}</span>
        </li>
      ))}
      {withdrawals.map((w) => (
        <li key={w.id} className="flex flex-wrap justify-between gap-2 px-4 py-2">
          <span>
            Вывод · {WITHDRAWAL_STATUS[w.status] ?? w.status}
            <span className="ml-2 font-mono text-xs text-secondary">{w.toAddress.slice(0, 10)}…</span>
          </span>
          <span className="tabular-nums">{centsText(w.amountMinor)}</span>
        </li>
      ))}
    </ul>
  );
}
