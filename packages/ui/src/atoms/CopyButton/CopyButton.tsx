'use client';

import { useState } from 'react';
import { cn } from '../../lib/cn';

/**
 * Кнопка «скопировать» для id/хэша/адреса. Только буфер обмена — ничего не
 * отправляет и не журналирует (копирование не изменяет состояние). Подтверждение
 * — смена иконки на 1,5 с, без анимаций.
 */
export interface CopyButtonProps {
  value: string;
  /** Что копируем — для aria-label («Скопировать id клиента»). */
  label?: string;
  className?: string;
}

export function CopyButton({ value, label = 'значение', className }: CopyButtonProps) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Скопировать ${label}`}
      title={done ? 'Скопировано' : `Скопировать ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className={cn(
        'text-muted hover:bg-primary/5 hover:text-primary inline-flex size-6 shrink-0 items-center justify-center rounded',
        className,
      )}
    >
      <svg
        viewBox="0 0 16 16"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden
      >
        {done ? (
          <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <>
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
            <path d="M10.5 3.5v-.5A1.5 1.5 0 009 1.5H3A1.5 1.5 0 001.5 3v6A1.5 1.5 0 003 10.5h.5" />
          </>
        )}
      </svg>
    </button>
  );
}
