import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  DOC_KIND_LABELS,
  getClientVerificationCard,
  type VerificationState,
} from '@/lib/kyc/queries';
import { DecisionForm } from './DecisionForm';

/**
 * Карточка клиента (ADM-08, Р-451 п.4): состояние проверки, поданные документы
 * (метаданные + вид + время + ссылка на хранилище) и, если клиент pending, —
 * форма решения «подтвердить» / «отклонить с причиной».
 *
 * Документы оператор только ПРОСМАТРИВАЕТ (метаданные/ссылку) — загрузка не
 * здесь (сторона кабинета). Решать можно лишь pending-клиента; у остальных
 * состояний формы нет (fail-closed переходами — см. `decide.ts`).
 */
export const dynamic = 'force-dynamic';

const STATE_LABELS: Record<VerificationState, string> = {
  unverified: 'Не проверен',
  pending: 'Ожидает решения',
  verified: 'Подтверждён',
  rejected: 'Отклонён',
};

function dateFmt(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function ClientKycCard({ params }: { params: { userId: string } }) {
  const card = await getClientVerificationCard(params.userId);
  if (!card) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/kyc" className="text-sm text-secondary hover:text-primary">
        ← к очереди
      </Link>

      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{card.fullName}</h1>
          <span className="rounded bg-accent/20 px-2 py-0.5 text-xs uppercase text-accent">
            {STATE_LABELS[card.state]}
          </span>
        </div>
        <p className="text-sm text-secondary">{card.email}</p>
        <p className="text-sm text-secondary">
          Зарегистрирован {dateFmt(card.registeredAt)} · обновлено {dateFmt(card.updatedAt)}
        </p>
      </div>

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
                <span className="shrink-0 text-sm text-secondary">подан {dateFmt(d.submittedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Решение</h2>
        {card.state === 'pending' ? (
          <DecisionForm userId={card.userId} />
        ) : (
          <p className="rounded border border-border bg-elevated px-4 py-4 text-sm text-secondary">
            Решение доступно только для клиента в состоянии «Ожидает решения». Текущее состояние —
            «{STATE_LABELS[card.state]}».
          </p>
        )}
      </section>
    </div>
  );
}
