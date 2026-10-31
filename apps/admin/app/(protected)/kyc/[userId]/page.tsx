import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ADDRESS_PROOF_MAX_AGE_DAYS,
  DOC_KIND_LABELS,
  getClientVerificationCard,
  isDocumentOlderThan,
  type VerificationState,
} from '@/lib/kyc/queries';
import { sourceOfFundsRuleText, sourceOfFundsStatus } from '@/lib/kyc/jurisdiction';
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
  resubmit_requested: 'Запрошена переподача',
};

function dateFmt(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function ClientKycCard({ params }: { params: { userId: string } }) {
  const card = await getClientVerificationCard(params.userId);
  if (!card) notFound();

  // ADM-11 (Р-454 I-2): статус «источника средств». Суммы депозитов в операторке
  // нет (принадлежат терминалу, Р-396) — режим «сумм нет»: отсутствие документа
  // даёт консервативный флаг «проверь вручную», а не «всё ок». Авто-подтягивание
  // сумм — вне scope ADM-11.
  const hasSourceOfFundsDoc = card.documents.some((d) => d.kind === 'source_of_funds');
  const sofStatus = sourceOfFundsStatus(hasSourceOfFundsDoc);

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
                  <span className="flex items-center gap-2 font-medium text-primary">
                    {DOC_KIND_LABELS[d.kind]}
                    {d.kind === 'address_proof' &&
                    isDocumentOlderThan(d.submittedAt, ADDRESS_PROOF_MAX_AGE_DAYS) ? (
                      <span
                        className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase text-amber-600 dark:text-amber-400"
                        title="Подтверждение адреса старше 3 месяцев (Р-451 п.4 требует ≤ 3 мес). Визуальный флаг, не блок."
                      >
                        старше 3 мес
                      </span>
                    ) : null}
                  </span>
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
        <h2 className="text-lg font-medium">Источник средств</h2>
        <div className="space-y-3 rounded border border-border bg-elevated px-4 py-4">
          <p className="text-sm text-secondary">{sourceOfFundsRuleText()}</p>
          {sofStatus === 'submitted' ? (
            <p className="text-sm text-positive">Документ «источник средств» подан.</p>
          ) : (
            <p
              role="status"
              className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400"
            >
              Источник средств не подан, а порог может требовать его. Суммы депозитов
              в операторке нет (принадлежат терминалу) — проверьте вручную, бьёт ли клиент
              порог; при необходимости запросите переподачу.
            </p>
          )}
        </div>
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
