import type { ClientJournalEntry } from '@/lib/clients/queries';

/**
 * Журнальная лента по субъекту-клиенту (ADM-02, §3.2, §5.3 `JournalFeed`).
 * Локальная (packages/ui не трогаем). Хронология (новые сверху): время,
 * оператор, действие, основание, раскрываемый payload, хеши цепочки. Это та же
 * неизменяемая лента `admin_action_journal`, отфильтрованная по `subjectId`.
 */

function dateFmt(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Человекочитаемые подписи операторских действий по клиенту. */
const ACTION_LABELS: Record<string, string> = {
  'client.block': 'Блокировка',
  'client.unblock': 'Разблокировка',
  'client.sessions_revoked': 'Гашение сессий',
  'client.document.viewed': 'Просмотр документа',
  'client.verification.verified': 'Верификация: подтверждена',
  'client.verification.rejected': 'Верификация: отклонена',
  'client.verification.resubmit_requested': 'Верификация: запрошена переподача',
};

function basisOf(payload: Record<string, unknown>): string | null {
  const basis = payload.basis;
  return typeof basis === 'string' && basis.length > 0 ? basis : null;
}

export function JournalFeed({ entries }: { entries: ClientJournalEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="rounded border border-border bg-elevated px-4 py-4 text-sm text-secondary">
        По этому клиенту ещё нет записей в журнале действий.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {entries.map((e) => {
        const basis = basisOf(e.payload);
        return (
          <li key={e.seq} className="rounded border border-border bg-elevated px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-primary">{ACTION_LABELS[e.action] ?? e.action}</span>
              <span className="tabular-nums text-xs text-secondary">{dateFmt(e.occurredAt)}</span>
            </div>
            <p className="text-xs text-secondary">
              Оператор: {e.operatorName ?? '—'}
              {e.operatorLogin ? ` (${e.operatorLogin})` : ''} · seq{' '}
              <span className="tabular-nums">{e.seq}</span>
            </p>
            {basis ? <p className="mt-1 text-sm text-primary">Основание: {basis}</p> : null}
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-secondary hover:text-primary">
                payload и хеши цепочки
              </summary>
              <pre className="mt-2 overflow-x-auto rounded bg-base px-3 py-2 text-xs text-secondary">
                {JSON.stringify(e.payload, null, 2)}
              </pre>
              <p className="mt-1 break-all font-mono text-[10px] text-secondary/70">
                entry_hash: {e.entryHash}
                {'\n'}prev_hash: {e.prevHash ?? '∅ (первая запись цепочки)'}
              </p>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
