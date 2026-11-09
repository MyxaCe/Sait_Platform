import { EmptyState, Mono, Timeline } from '@broker/ui';
import type { ClientJournalEntry } from '@/lib/clients/queries';
import { actionLabel } from '@/lib/journal/labels';
import { fmtDateTime } from '@/lib/ui/format';

/**
 * Журнальная лента по субъекту-клиенту (ADM-02, §3.2). Хронология (новые
 * сверху): действие (человекочитаемо, тон — единая семантика), оператор, seq,
 * основание; раскрываемые payload и хэши цепочки (нативный <details>, без JS).
 * Это та же неизменяемая лента `admin_action_journal`, отфильтрованная по
 * `subjectId`. `limit` — для сводки на «Обзоре».
 */

function basisOf(payload: Record<string, unknown>): string | null {
  const basis = payload.basis;
  return typeof basis === 'string' && basis.length > 0 ? basis : null;
}

export function JournalFeed({
  entries,
  limit,
  withDetails = true,
}: {
  entries: ClientJournalEntry[];
  limit?: number;
  withDetails?: boolean;
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        size="compact"
        title="Записей пока нет"
        description="По этому клиенту операторы ещё не совершали действий."
      />
    );
  }

  const shown = limit ? entries.slice(0, limit) : entries;
  return (
    <Timeline
      items={shown.map((e) => {
        const a = actionLabel(e.action);
        const basis = basisOf(e.payload);
        return {
          key: String(e.seq),
          tone: a.tone,
          title: a.label,
          time: fmtDateTime(e.occurredAt),
          meta: (
            <>
              {e.operatorName ?? '—'}
              {e.operatorLogin ? <span className="text-muted"> ({e.operatorLogin})</span> : null} ·{' '}
              <span className="tabular-nums">seq {e.seq}</span>
            </>
          ),
          body: basis ? (
            <>
              <span className="text-muted">Основание: </span>
              <span className="text-primary">{basis}</span>
            </>
          ) : undefined,
          detailsLabel: 'payload и хэши цепочки',
          details: withDetails ? (
            <div className="space-y-2 rounded-md border border-border bg-sunken p-3">
              <pre className="overflow-x-auto font-mono text-xs text-secondary">
                {JSON.stringify(e.payload, null, 2)}
              </pre>
              <p className="break-all text-[11px] text-muted">
                entry_hash <Mono value={e.entryHash} className="text-secondary" />
                <br />
                prev_hash{' '}
                {e.prevHash ? <Mono value={e.prevHash} className="text-secondary" /> : '∅ (первая запись цепочки)'}
              </p>
            </div>
          ) : undefined,
        };
      })}
    />
  );
}
