import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Встроенное уведомление (концепция §6.8): состояние объекта или результат
 * действия, которое оператор ДОЛЖЕН увидеть рядом с местом работы («Клиент
 * заблокирован…», «Терминал недоступен…», «Флаги сохранены»). Не исчезает само
 * (в отличие от тоста). `role` — alert для negative/warning, status для прочих.
 */
export type CalloutTone = 'info' | 'positive' | 'warning' | 'negative' | 'neutral';

const TONE: Record<CalloutTone, string> = {
  info: 'border-info/30 bg-info/[0.07]',
  positive: 'border-positive/30 bg-positive/[0.07]',
  warning: 'border-warning/35 bg-warning/[0.07]',
  negative: 'border-negative/35 bg-negative/[0.07]',
  neutral: 'border-border bg-primary/[0.03]',
};

const COLOR: Record<CalloutTone, string> = {
  info: 'text-info',
  positive: 'text-positive',
  warning: 'text-warning',
  negative: 'text-negative',
  neutral: 'text-secondary',
};

function Icon({ tone }: { tone: CalloutTone }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={cn('mt-0.5 size-4 shrink-0', COLOR[tone])}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      {tone === 'positive' ? (
        <>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M5.25 8.25l1.75 1.75 3.75-3.75" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : tone === 'negative' || tone === 'warning' ? (
        <>
          <path d="M8 1.75l6.5 11.5h-13z" strokeLinejoin="round" />
          <path d="M8 6.25v3.25M8 11.5v.25" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 7.25v4M8 4.75v.25" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export interface CalloutProps {
  tone?: CalloutTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Действия справа (ссылка/кнопка). */
  actions?: ReactNode;
  className?: string;
}

export function Callout({ tone = 'info', title, children, actions, className }: CalloutProps) {
  return (
    <div
      role={tone === 'negative' || tone === 'warning' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-lg border px-3.5 py-3 text-sm', TONE[tone], className)}
    >
      <Icon tone={tone} />
      <div className="min-w-0 flex-1">
        {title ? <p className={cn('font-medium', COLOR[tone])}>{title}</p> : null}
        {children ? (
          <div className={cn('text-secondary', title ? 'mt-0.5' : undefined)}>{children}</div>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}
