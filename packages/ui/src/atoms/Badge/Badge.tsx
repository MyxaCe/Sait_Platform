import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

type BadgeVariant = 'accent' | 'neutral' | 'positive' | 'negative';

const styles: Record<BadgeVariant, string> = {
  accent: 'border-accent/30 bg-accent/10 text-accent',
  neutral: 'border-border bg-elevated text-secondary',
  positive: 'border-positive/30 bg-positive/10 text-positive',
  negative: 'border-negative/30 bg-negative/10 text-negative',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ variant = 'accent', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm',
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}
