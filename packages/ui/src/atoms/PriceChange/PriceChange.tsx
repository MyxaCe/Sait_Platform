import { cn } from '../../lib/cn';

export interface PriceChangeProps {
  /**
   * Изменение в процентах: 1.24 → «▲ +1.24%».
   *
   * `null` — изменение неизвестно: прочерк, без цвета и стрелки. Это не то
   * же самое, что ноль: ноль выводится как «0.00%» и означает «цена не
   * изменилась». Раньше `null` доходил сюда и выпадал в ветку по умолчанию —
   * обе проверки порога ложны, `Math.abs(null)` даёт 0 — и выводилось
   * нейтральное «0.00%», неотличимое от настоящей стабильной цены.
   */
  value: number | null;
  /** Подпись прочерка для screen reader и тултипа; перевод даёт приложение */
  noDataLabel?: string;
  className?: string;
}

export function PriceChange({ value, noDataLabel = 'нет данных', className }: PriceChangeProps) {
  // Проверка стоит до арифметики и сравнений: любое из них ниже превратило бы
  // «не знаем» в уверенное число.
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
