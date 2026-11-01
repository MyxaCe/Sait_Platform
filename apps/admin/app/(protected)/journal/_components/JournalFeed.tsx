'use client';

import { useState } from 'react';
import type { JournalRow } from '../queries';

/**
 * Журнальная лента (ADM-06, § 5.3 п.5 JournalFeed). Плотный служебный список:
 * время, оператор, действие, субъект, основание, раскрываемый payload и хеши
 * `entry_hash`/`prev_hash`. Локальный компонент зоны — общих примитивов
 * (`DataTable`) на ветке ещё нет (анти-коллизия).
 *
 * Чистое отображение: данные уже отфильтрованы и отобраны по роли на сервере.
 */

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'medium' });
}

function shortHash(hash: string | null): string {
  if (!hash) return '—';
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

/** Основание из payload (если есть) — его видно без раскрытия. */
function basisOf(payload: Record<string, unknown>): string | null {
  const b = payload.basis ?? payload.reason;
  return typeof b === 'string' && b.length > 0 ? b : null;
}

function Row({ entry }: { entry: JournalRow }) {
  const [open, setOpen] = useState(false);
  const basis = basisOf(entry.payload);

  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-4 px-4 py-2.5 text-left hover:bg-accent/5"
      >
        <span className="w-10 shrink-0 pt-0.5 text-right text-xs tabular-nums text-secondary">
          {entry.seq}
        </span>
        <span className="w-44 shrink-0 pt-0.5 text-xs tabular-nums text-secondary">
          {fmtTime(entry.occurredAt)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-xs text-accent">
              {entry.action}
            </span>
            <span className="truncate text-sm text-primary">{entry.operatorName}</span>
            <span className="truncate text-xs text-secondary">
              {entry.subjectKind}:{entry.subjectId}
            </span>
          </span>
          {basis ? (
            <span className="mt-0.5 block truncate text-xs text-secondary/90">{basis}</span>
          ) : null}
        </span>
        <span aria-hidden className="shrink-0 pt-0.5 text-xs text-secondary">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open ? (
        <div className="space-y-2 border-t border-border bg-base px-4 py-3 pl-[13.5rem] text-xs">
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
            <dt className="text-secondary">Оператор</dt>
            <dd className="text-primary">
              {entry.operatorName}{' '}
              <span className="text-secondary">({entry.operatorLogin})</span>
            </dd>
            <dt className="text-secondary">entry_hash</dt>
            <dd className="break-all font-mono text-primary" title={entry.entryHash}>
              {entry.entryHash}
            </dd>
            <dt className="text-secondary">prev_hash</dt>
            <dd className="break-all font-mono text-secondary" title={entry.prevHash ?? '—'}>
              {entry.prevHash ?? '— (начало цепочки)'}
            </dd>
          </dl>
          <div>
            <span className="mb-1 block text-secondary">payload</span>
            <pre className="overflow-x-auto rounded border border-border bg-elevated p-2 font-mono text-[11px] text-primary">
              {JSON.stringify(entry.payload, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function JournalFeed({ entries }: { entries: JournalRow[] }) {
  if (entries.length === 0) {
    return (
      <p className="rounded border border-border bg-elevated px-4 py-6 text-center text-secondary">
        Записей по текущему фильтру нет.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded border border-border bg-elevated">
      <div className="flex items-center gap-4 border-b border-border bg-card px-4 py-2 text-[11px] uppercase tracking-wide text-secondary">
        <span className="w-10 text-right">seq</span>
        <span className="w-44">время</span>
        <span className="flex-1">действие · оператор · субъект · основание</span>
        <span className="w-4" />
      </div>
      <ul className="tabular-nums">
        {entries.map((e) => (
          <Row key={e.seq} entry={e} />
        ))}
      </ul>
    </div>
  );
}
