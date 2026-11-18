import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type KpiTone = 'default' | 'accent' | 'positive' | 'negative' | 'warning';

const TONE_VALUE: Record<KpiTone, string> = {
  default: 'text-primary',
  accent: 'text-accent',
  positive: 'text-positive',
  negative: 'text-negative',
  warning: 'text-warning',
};

const TONE_BAR: Record<KpiTone, string> = {
  default: 'bg-transparent',
  accent: 'bg-accent',
  positive: 'bg-positive',
  negative: 'bg-negative',
  warning: 'bg-warning',
};

export interface KpiTileProps {
  label: string;
  value?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  placeholder?: boolean;
  placeholderHint?: string;
  tone?: KpiTone;
  className?: string;
}

export function KpiTile({
  label,
  value,
  hint,
  action,
  placeholder = false,
  placeholderHint = 'нет данных',
  tone = 'default',
  className,
}: KpiTileProps) {
  return (
    <div
      className={cn(
        'border-border bg-card relative flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-lg border px-4 py-3.5',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn('absolute inset-y-3 left-0 w-0.5 rounded-r', TONE_BAR[tone])}
      />
      <div className="flex items-start justify-between gap-2">
        <span className="text-secondary text-xs font-medium">{label}</span>
        {action ? <span className="shrink-0 text-xs">{action}</span> : null}
      </div>
      {placeholder ? (
        <>
          <span className="text-muted text-2xl font-semibold tabular-nums leading-8">—</span>
          <span className="text-muted text-xs">{placeholderHint}</span>
        </>
      ) : (
        <>
          <span
            className={cn(
              'truncate text-2xl font-semibold tabular-nums leading-8 tracking-tight',
              TONE_VALUE[tone],
            )}
          >
            {value}
          </span>
          {hint ? <span className="text-muted truncate text-xs">{hint}</span> : null}
        </>
      )}
    </div>
  );
}
