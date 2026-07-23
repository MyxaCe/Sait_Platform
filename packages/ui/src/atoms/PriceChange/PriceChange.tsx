import { cn } from '../../lib/cn';

export interface PriceChangeProps {
  /** Изменение в процентах: 1.24 → «▲ +1.24%» */
  value: number;
  className?: string;
}

export function PriceChange({ value, className }: PriceChangeProps) {
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
