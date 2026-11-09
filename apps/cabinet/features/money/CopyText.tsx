'use client';

import { useState } from 'react';
import { cn } from '@broker/ui';

async function copy(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function Glyph({ done }: { done: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      {done ? (
        <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <>
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
          <path d="M10.5 3.5v-.5A1.5 1.5 0 009 1.5H3A1.5 1.5 0 001.5 3v6A1.5 1.5 0 003 10.5h.5" />
        </>
      )}
    </svg>
  );
}

/**
 * Крупная кнопка «Скопировать адрес» (телефон: палец, а не мышь). Только
 * буфер обмена; подтверждение — смена подписи на 2 с, `aria-live`.
 */
export function CopyButtonLarge({
  value,
  label,
  doneLabel,
  className,
}: {
  value: string;
  label: string;
  doneLabel: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copy(value)) {
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        }
      }}
      className={cn(
        'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-border-strong bg-card px-4 text-sm font-medium transition-colors hover:bg-primary/5',
        done ? 'text-positive' : 'text-primary',
        className,
      )}
    >
      <Glyph done={done} />
      <span aria-live="polite">{done ? doneLabel : label}</span>
    </button>
  );
}

/** Иконка-копирование рядом с хэшем/адресом в истории (цель касания 32 px). */
export function CopyIcon({ value, label, doneLabel }: { value: string; label: string; doneLabel: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={done ? doneLabel : label}
      title={done ? doneLabel : label}
      onClick={async () => {
        if (await copy(value)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
      className={cn(
        'inline-grid size-8 shrink-0 place-items-center rounded-md hover:bg-primary/5',
        done ? 'text-positive' : 'text-muted hover:text-primary',
      )}
    >
      <Glyph done={done} />
    </button>
  );
}
