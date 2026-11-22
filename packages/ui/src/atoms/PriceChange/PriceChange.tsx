import { cn } from '../../lib/cn';

export interface PriceChangeProps {
  value: number | null;
  noDataLabel?: string;
  className?: string;
}

export function PriceChange({ value, noDataLabel = 'нет данных', className }: PriceChangeProps) {
  if (value === null) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 text-sm tabular-nums text-secondary',
          className,
        )}
        title={noDataLabel}
        aria-label={noDataLabel}
      >
        —
      </span>
    );
  }

  const positive = value > 0.005;
  const negative = value < -0.005;
  const text = `${positive ? '+' : negative ? '−' : ''}${Math.abs(value).toFixed(2)}%`;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-sm tabular-nums',
        positive && 'text-positive',
        negative && 'text-negative',
        !positive && !negative && 'text-secondary',
        className,
      )}
    >
      {(positive || negative) && (
        <svg
          aria-hidden
          viewBox="0 0 8 6"
          className={cn('size-2 fill-current', negative && 'rotate-180')}
        >
          <path d="M4 0 8 6H0Z" />
        </svg>
      )}
      {text}
    </span>
  );
}
