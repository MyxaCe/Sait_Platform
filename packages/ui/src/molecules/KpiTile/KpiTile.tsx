import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type KpiTone = 'default' | 'accent' | 'positive' | 'negative' | 'warning';

const TONE_VALUE: Record<KpiTone, string> = {
  default: 'text-primary',
  accent: 'text-accent',
  positive: 'text-positive',
  negative: 'text-negative',
  warning: 'text-accent',
};

export interface KpiTileProps {
  /** Короткая подпись плитки (что это за число). */
  label: string;
  /**
   * Значение: число или готовый узел (напр. индикатор здоровья). Числа —
   * мгновенные и точные, `tabular-nums`, БЕЗ анимации-разгона (§5.4 — это
   * операторский пульт, не витрина).
   */
  value?: ReactNode;
  /** Вторичная строка под значением (возраст, детализация, «из N»). */
  hint?: ReactNode;
  /**
   * `true` — данных для плитки ещё нет. Рисуем честное «—» и подпись «скоро»
   * вместо выдуманного числа (анти-паттерн операторского дашборда).
   */
  placeholder?: boolean;
  tone?: KpiTone;
  className?: string;
}

/**
 * KPI-плитка операторского дашборда (§4.1, §5.3). Плотная, служебная, без
 * витринной анимации. Либо реальное значение, либо явный плейсхолдер «скоро» —
 * никаких догадок на месте отсутствующих данных.
 */
export function KpiTile({
  label,
  value,
  hint,
  placeholder = false,
  tone = 'default',
  className,
}: KpiTileProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3',
        className,
      )}
    >
      <span className="text-xs uppercase tracking-wide text-secondary">{label}</span>
      {placeholder ? (
        <>
          <span className="text-2xl font-semibold tabular-nums text-secondary/50">—</span>
          <span className="text-xs text-secondary/70">скоро</span>
        </>
      ) : (
        <>
          <span className={cn('text-2xl font-semibold tabular-nums', TONE_VALUE[tone])}>
            {value}
          </span>
          {hint ? <span className="text-xs text-secondary">{hint}</span> : null}
        </>
      )}
    </div>
  );
}
