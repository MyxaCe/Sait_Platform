'use client';

import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
  /** `compact` — плотный контрол операторского периметра (36px, rounded-md, bg-sunken). */
  controlSize?: 'md' | 'compact';
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid, controlSize = 'md', children, ...props }, ref) => (
    <span className={cn('relative block', className)}>
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'border-border bg-card text-primary h-11 w-full cursor-pointer appearance-none rounded-xl border px-4 pr-10 text-sm',
          'focus:border-accent/60 focus:ring-accent/20 transition-colors focus:outline-none focus:ring-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          controlSize === 'compact' && 'bg-sunken h-9 rounded-md px-3 pr-9',
          invalid && 'border-negative/60 focus:border-negative focus:ring-negative/20',
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 10 6"
        className={cn(
          'text-secondary pointer-events-none absolute top-1/2 size-2.5 -translate-y-1/2 fill-none stroke-current',
          controlSize === 'compact' ? 'right-3' : 'right-4',
        )}
      >
        <path d="M1 1l4 4 4-4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  ),
);
Select.displayName = 'Select';
