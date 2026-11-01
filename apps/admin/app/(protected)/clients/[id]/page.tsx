import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getClientCard, type ClientJournalEntry } from '@/lib/clients/queries';
import { DOC_KIND_LABELS, STATE_LABELS } from '@/lib/clients/verification-state';
import { getOperatorSession } from '@/lib/auth/current';
import { VerificationBadge, BlockBadge } from '../_components/StatusBadge';
import { JournalFeed } from './_components/JournalFeed';
import { ViewDocumentButton } from './_components/ViewDocumentButton';
import { BlockPanel } from './_components/BlockPanel';

/**
 * Карточка клиента `/clients/[id]` (ADM-02, §3.2): досье — профиль, состояние
 * верификации с историей переходов, документы (с превью), активность, текущие
 * сессии, журнальная лента по этому субъекту; блокировка/разблокировка и
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
