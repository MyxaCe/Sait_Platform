'use client';

import { useState, useTransition } from 'react';
import { Button } from '@broker/ui';
import { exportJournalAction, type ExportState } from '../actions';
import type { JournalFilters } from '../queries';

/**
 * Экспорт выборки (ADM-06, § 3.10). Экспорт САМ journal-able: admin-экшен
 * сперва пишет `journal.exported` (основание = объём + фильтр), затем отдаёт
 * сериализацию, которую мы сохраняем файлом на стороне браузера. Основание
 * (заметка) опционально дополняет авто-основание из фильтра.
 *
 * Рендерится только для admin (роль-гейт в `page.tsx`); экшен проверяет роль
 * сам (fail-closed).
 */
export function ExportButton({ filters }: { filters: JournalFilters }) {
  const [note, setNote] = useState('');
  const [state, setState] = useState<ExportState | null>(null);
  const [pending, startTransition] = useTransition();

  function doExport() {
    startTransition(async () => {
      const result = await exportJournalAction(filters, note);
      setState(result);
      if (result.ok) {
        const blob = new Blob([result.json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    });
  }

  return (
    <div className="space-y-3 rounded border border-border bg-elevated p-4">
      <div>
        <h2 className="text-sm font-medium text-primary">Экспорт выборки</h2>
        <p className="text-xs text-secondary">
          Выгрузка журнала по текущему фильтру в JSON. Экспорт оставляет запись{' '}
          <span className="font-mono">journal.exported</span> в самом журнале.
        </p>
      </div>

      <label className="flex flex-col gap-1 text-xs text-secondary">
        Основание выгрузки (опционально)
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="например: запрос комплаенса №…"
          className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-primary outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
        />
      </label>

      <Button type="button" size="sm" variant="secondary" onClick={doExport} loading={pending} disabled={pending}>
        {pending ? 'Готовлю выгрузку…' : 'Экспортировать выборку'}
      </Button>

      {state && !state.ok && state.forbidden ? (
        <p role="alert" className="rounded border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative">
          Экспорт доступен только администратору.
        </p>
      ) : null}
      {state && state.ok ? (
        <p role="status" className="rounded border border-positive/40 bg-positive/10 px-3 py-2 text-sm text-positive">
          Выгружено {state.count} записей — файл сохранён, экспорт записан в журнал.
        </p>
      ) : null}
    </div>
  );
}
