import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/**
 * Машинные строки — хэши транзакций, адреса кошельков, UUID, seq — моноширинным
 * системным шрифтом (концепция §4.1). `middle` укорачивает посередине
 * («a1b2c3…f9e8»): у хэшей значимы и начало, и конец; полное значение — в
 * `title` и для копирования (см. CopyButton).
 */
export interface MonoProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  value: string;
  /** Сколько символов оставить с каждой стороны; не задано — без сокращения. */
  middle?: number;
}

export function shortenMiddle(value: string, keep: number): string {
  if (value.length <= keep * 2 + 1) return value;
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

export function Mono({ value, middle, className, ...props }: MonoProps) {
  return (
    <span
      title={middle ? value : undefined}
      className={cn('whitespace-nowrap font-mono text-[0.92em] tracking-tight', className)}
      {...props}
    >
      {middle ? shortenMiddle(value, middle) : value}
    </span>
  );
}
