import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface MonoProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  value: string;
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
