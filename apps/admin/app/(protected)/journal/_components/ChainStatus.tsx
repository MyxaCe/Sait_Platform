'use client';

import { useState, useTransition } from 'react';
import { Button } from '@broker/ui';
import { verifyChainAction, type VerifyChainState } from '../actions';

/**
 * Проверка целостности цепочки (ADM-06, § 3.10). Кнопка «проверить цепочку»
 * вызывает admin-экшен, который пересчитывает хеши РОВНО тем же
 * `computeEntryHash`/`canonicalize`, что и запись, и показывает статус:
 * «цепочка цела» (N записей) или «разрыв на seq N» с родом разрыва.
 *
 * Рендерится только для admin (роль-гейт в `page.tsx`); экшен всё равно
 * проверяет роль сам (fail-closed, defense-in-depth).
 */
export function ChainStatus() {
  const [state, setState] = useState<VerifyChainState>({ checked: false });
  const [pending, startTransition] = useTransition();

  function check() {
    startTransition(async () => {
      const next = await verifyChainAction();
      setState(next);
    });
  }

  return (
    <div className="space-y-3 rounded border border-border bg-elevated p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-primary">Целостность цепочки</h2>
          <p className="text-xs text-secondary">
            Пересчёт хеш-цепочки всего журнала (prev_hash → entry_hash).
          </p>
        </div>
        <Button type="button" size="sm" onClick={check} loading={pending} disabled={pending}>
          {pending ? 'Проверяю…' : 'Проверить цепочку'}
        </Button>
      </div>

      {state.checked && 'forbidden' in state && state.forbidden ? (
        <p
          role="alert"
          className="rounded border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative"
        >
          Проверка цепочки доступна только администратору.
        </p>
      ) : null}

      {state.checked && 'result' in state && state.result ? (
        state.result.ok ? (
          <p
            role="status"
            className="rounded border border-positive/40 bg-positive/10 px-3 py-2 text-sm text-positive"
          >
            Цепочка цела: проверено {state.result.count} записей, разрывов нет.
          </p>
        ) : (
          <p
            role="alert"
            className="rounded border border-negative/40 bg-negative/10 px-3 py-2 text-sm text-negative"
          >
            Разрыв цепочки на seq {state.result.brokenSeq}:{' '}
            {state.result.reason === 'link'
              ? 'prev_hash не сходится с предыдущей записью (звено изъято или переставлено)'
              : 'entry_hash не сходится с содержимым (запись подменена)'}
            . Проверено всего {state.result.count} записей.
          </p>
        )
      ) : null}
    </div>
  );
}
