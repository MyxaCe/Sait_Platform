'use client';

import { useState, useTransition } from 'react';
import { Button, Callout, Panel } from '@broker/ui';
import { verifyChainAction, type VerifyChainState } from '../actions';

/**
 * «Целостность журнала» (ADM-06, § 3.10). Объясняет, почему журналу можно
 * верить (append-only на уровне базы + хеш-цепочка SHA-256), и даёт админу
 * пересчитать цепочку целиком: admin-экшен считает хеши РОВНО тем же
 * `computeEntryHash`/`canonicalize`, что и запись, и показывает итог —
 * «цепочка цела» (N записей) или «разрыв на seq N» с родом разрыва.
 *
 * Кнопка — только для admin (роль-гейт в `page.tsx`, `canVerify`); экшен всё
 * равно проверяет роль сам (fail-closed, defense-in-depth). Остальные роли
 * видят то же объяснение без кнопки.
 */

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted text-xs">{label}</dt>
      <dd className="text-primary mt-0.5 text-[15px] font-semibold tabular-nums tracking-tight">
        {value}
      </dd>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="text-positive size-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l7 3v5c0 4.2-3 7.4-7 9-4-1.6-7-4.8-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function ChainStatus({
  total,
  lastSeq,
  lastAt,
  canVerify,
}: {
  total: number;
  lastSeq: number | null;
  /** Уже отформатированное время последней записи. */
  lastAt: string | null;
  canVerify: boolean;
}) {
  const [state, setState] = useState<VerifyChainState>({ checked: false });
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function check() {
    startTransition(async () => {
      const next = await verifyChainAction();
      setState(next);
      setCheckedAt(
        new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      );
    });
  }

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <ShieldIcon />
          Целостность журнала
        </span>
      }
      description="Записи только добавляются. Каждая скреплена хешем предыдущей — подмену, удаление или перестановку видно при пересчёте."
      actions={
        canVerify ? (
          <Button
            type="button"
            size="xs"
            variant="secondary"
            onClick={check}
            loading={pending}
            disabled={pending}
          >
            {pending ? 'Пересчитываю…' : 'Проверить цепочку'}
          </Button>
        ) : null
      }
      className="h-full"
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Fact label="Записей в цепочке" value={total.toLocaleString('ru-RU')} />
          <Fact label="Последняя запись" value={lastSeq != null ? `seq ${lastSeq}` : '—'} />
          <Fact label="Время последней" value={lastAt ?? '—'} />
          <Fact label="Хеш" value="SHA-256" />
        </dl>
        <ul className="text-secondary grid gap-1.5 text-[13px] sm:grid-cols-2">
          <li className="flex gap-2">
            <span aria-hidden className="text-muted">
              —
            </span>
            Изменение и удаление записей запрещены на уровне базы данных.
          </li>
          <li className="flex gap-2">
            <span aria-hidden className="text-muted">
              —
            </span>
            Каждая запись хранит хеш предыдущей (prev_hash) и свой (entry_hash).
          </li>
        </ul>

        {state.checked && 'forbidden' in state && state.forbidden ? (
          <Callout tone="negative">Проверка цепочки доступна только администратору.</Callout>
        ) : null}

        {state.checked && 'result' in state && state.result ? (
          state.result.ok ? (
            <Callout tone="positive" title="Цепочка цела">
              Пересчитано {state.result.count.toLocaleString('ru-RU')} записей с первой по последнюю
              — расхождений нет{checkedAt ? ` (проверка в ${checkedAt})` : ''}.
            </Callout>
          ) : (
            <Callout tone="negative" title={`Разрыв цепочки на seq ${state.result.brokenSeq}`}>
              {state.result.reason === 'link'
                ? 'prev_hash не сходится с предыдущей записью — звено изъято или переставлено.'
                : 'entry_hash не сходится с содержимым — запись подменена.'}{' '}
              Проверено записей: {state.result.count.toLocaleString('ru-RU')}.
            </Callout>
          )
        ) : null}

        {!canVerify ? (
          <p className="text-muted text-xs">Пересчёт цепочки запускает администратор.</p>
        ) : null}
      </div>
    </Panel>
  );
}
