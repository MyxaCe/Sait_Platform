'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** `compact` — плотный контрол операторского периметра (36px, rounded-md, bg-sunken). */
  controlSize?: 'md' | 'compact';
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, controlSize = 'md', ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        // min-h 44px — touch-target
        'border-border bg-card text-primary h-11 w-full rounded-xl border px-4 text-sm',
        'placeholder:text-secondary/60',
        'focus:border-accent/60 focus:ring-accent/20 transition-colors focus:outline-none focus:ring-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        controlSize === 'compact' && 'bg-sunken placeholder:text-muted h-9 rounded-md px-3',
        invalid && 'border-negative/60 focus:border-negative focus:ring-negative/20',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
