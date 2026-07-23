'use client';

import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid, children, ...props }, ref) => (
    <span className={cn('relative block', className)}>
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-11 w-full cursor-pointer appearance-none rounded-xl border border-border bg-card px-4 pr-10 text-sm text-primary',
          'transition-colors focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/20',
          'disabled:cursor-not-allowed disabled:opacity-50',
          invalid && 'border-negative/60 focus:border-negative focus:ring-negative/20',
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 10 6"
        className="pointer-events-none absolute right-4 top-1/2 size-2.5 -translate-y-1/2 fill-none stroke-current text-secondary"
      >
        <path d="M1 1l4 4 4-4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  ),
);
Select.displayName = 'Select';
