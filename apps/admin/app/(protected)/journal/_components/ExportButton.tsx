'use client';

import { useState, useTransition } from 'react';
import { Button, Callout, Input, Panel } from '@broker/ui';
import { exportJournalAction, type ExportState } from '../actions';
import type { JournalFilters } from '../queries';

/**
 * Выгрузка выборки (ADM-06, § 3.10). Экспорт САМ journal-able: admin-экшен
 * сперва пишет `journal.exported` (основание = объём + фильтр), затем отдаёт
 * сериализацию, которую мы сохраняем файлом на стороне браузера. Основание
 * (заметка) опционально дополняет авто-основание из фильтра.
 *
 * Рендерится только для admin (роль-гейт в `page.tsx`); экшен проверяет роль
 * сам (fail-closed).
 */
export function ExportButton({ filters, count }: { filters: JournalFilters; count: number }) {
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
    <Panel
      title="Выгрузка для проверки"
      description="JSON по текущему фильтру — для аудитора или регулятора."
      className="h-full"
    >
      <div className="space-y-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-secondary text-xs font-medium">Основание выгрузки</span>
          <Input
            controlSize="compact"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="например, запрос комплаенса № 14/11"
          />
        </label>
        <Button
          type="button"
          size="compact"
          variant="secondary"
          onClick={doExport}
          loading={pending}
          disabled={pending || count === 0}
          className="w-full"
        >
          {pending
            ? 'Готовлю выгрузку…'
            : `Выгрузить ${count.toLocaleString('ru-RU')} ${plural(count)}`}
        </Button>
        <p className="text-muted text-xs">
          Сама выгрузка тоже пишется в журнал — кто, когда и что выгрузил.
        </p>

        {state && !state.ok && state.forbidden ? (
          <Callout tone="negative">Выгрузка доступна только администратору.</Callout>
        ) : null}
        {state && state.ok ? (
          <Callout tone="positive">
            Выгружено {state.count.toLocaleString('ru-RU')} {plural(state.count)} — файл сохранён,
            выгрузка записана в журнал.
          </Callout>
        ) : null}
      </div>
    </Panel>
  );
}

function plural(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'запись';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'записи';
  return 'записей';
}
