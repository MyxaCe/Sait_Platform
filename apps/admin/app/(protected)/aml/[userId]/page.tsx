import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAmlCard } from '@/lib/aml/queries';
import { AML_STATUS_LABELS, sanctionsListLabel, type AmlStatus } from '@/lib/aml/lists';
import { getOperatorSession } from '@/lib/auth/current';
import { ScreeningForm } from './ScreeningForm';
import { ClearEscalationForm } from './ClearEscalationForm';

/**
 * Карточка AML-скрининга клиента (ADM-14, Р-454 I-5, Р-456 D): текущий статус,
 * основание и списки последней сверки, состояние блокировки, полная история
 * скринингов (из журнала), форма фиксации нового результата и — при эскалации,
 * для admin — снятие эскалации.
 *
 * Проверку оператор делает ВРУЧНУЮ во внешних источниках (OFSI/OFAC/EU, PEP);
 * форма фиксирует РЕЗУЛЬТАТ («проверено» / «найдено→эскалация») с основанием.
 * Исход «найдено» блокирует клиента автоматически (Р-456 D). Роль-гейт
 * operator+admin — на layout/middleware; снятие эскалации — admin only
 * (fail-closed на сервере, `lib/aml/actions.ts`).
 */
export const dynamic = 'force-dynamic';

/** Подпись записи истории по действию журнала. */
const HISTORY_ACTION_LABELS: Record<string, string> = {
  'client.aml_checked': 'Проверено — совпадений нет',
  'client.aml_escalated': 'Найдено — эскалация (авто-блок)',
  'client.aml_escalation_cleared': 'Эскалация снята (ложное срабатывание)',
};

const STATUS_TONE: Record<AmlStatus, string> = {
  escalated: 'bg-negative/15 text-negative',
  unscreened: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  clear: 'bg-positive/15 text-positive',
};

function dateFmt(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function ClientAmlCard({ params }: { params: { userId: string } }) {
  const [card, operator] = await Promise.all([
    getAmlCard(params.userId),
    getOperatorSession(),
  ]);
  if (!card) notFound();

  const isAdmin = operator?.role === 'admin';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/aml" className="text-sm text-secondary hover:text-primary">
        ← к рабочему списку
      </Link>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{card.fullName}</h1>
          <span className={`rounded px-2 py-0.5 text-xs uppercase ${STATUS_TONE[card.status]}`}>
            {AML_STATUS_LABELS[card.status]}
          </span>
        </div>
        <p className="text-sm text-secondary">{card.email}</p>
        {card.screenedAt ? (
          <p className="text-sm text-secondary">
            Последняя сверка {dateFmt(card.screenedAt)}
            {card.screenedByName ? ` · ${card.screenedByName}` : ''}
            {card.listsChecked.length > 0
              ? ` · списки: ${card.listsChecked.map(sanctionsListLabel).join(', ')}`
              : ''}
          </p>
        ) : null}
        {card.reason ? (
          <p className="text-sm text-secondary">Основание последней сверки: {card.reason}</p>
        ) : null}
      </div>

      {card.blocked ? (
        <div className="rounded border border-negative/40 bg-negative/10 px-4 py-3 text-sm">
          <p className="font-medium text-negative">Клиент заблокирован.</p>
          {card.blockReason ? (
            <p className="text-secondary">Основание: {card.blockReason}</p>
          ) : null}
          {card.status === 'escalated' ? (
            <p className="text-secondary">
              Блок выставлен автоматически по AML-эскалации (Р-456 D). Снять — только после ручной
              проверки, действием ниже.
            </p>
          ) : null}
        </div>
      ) : null}

      {card.status === 'escalated' ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Снять эскалацию (ложное срабатывание)</h2>
          {isAdmin ? (
            <ClearEscalationForm userId={card.userId} />
          ) : (
            <p className="rounded border border-border bg-elevated px-4 py-4 text-sm text-secondary">
              Снятие AML-эскалации и разблокировка доступны только администратору. Оператор может
              эскалировать, но не снимать эскалацию.
            </p>
          )}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Зафиксировать результат сверки</h2>
        <p className="text-sm text-secondary">
          Сверьте клиента во внешних источниках (OFSI/OFAC/EU consolidated, PEP), затем отметьте
          исход и основание. Каждая отметка журналируется с основанием (Р-049). Автоматическая
          интеграция со скрининг-провайдером — отдельная будущая задача.
        </p>
        <ScreeningForm userId={card.userId} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">История сверок</h2>
        {card.history.length === 0 ? (
          <p className="rounded border border-border bg-elevated px-4 py-4 text-sm text-secondary">
            Сверок ещё не было.
          </p>
        ) : (
          <ol className="space-y-2 border-l border-border pl-4">
            {card.history.map((h) => (
              <li key={h.seq} className="relative">
                <span
                  className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-accent"
                  aria-hidden
                />
                <p className="text-sm text-primary">
                  {HISTORY_ACTION_LABELS[h.action] ?? AML_STATUS_LABELS[h.outcome]}
                  {h.lists.length > 0 ? (
                    <span className="text-secondary">
                      {' '}
                      · {h.lists.map(sanctionsListLabel).join(', ')}
                    </span>
                  ) : null}
                </p>
                {h.basis ? <p className="text-sm text-secondary">Основание: {h.basis}</p> : null}
                <p className="tabular-nums text-xs text-secondary">
                  {dateFmt(h.occurredAt)} · {h.operatorName ?? '—'}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
