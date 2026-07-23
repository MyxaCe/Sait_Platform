'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        // min-h 44px — touch-target
        'h-11 w-full rounded-xl border border-border bg-card px-4 text-sm text-primary',
        'placeholder:text-secondary/60',
        'transition-colors focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/20',
        'disabled:cursor-not-allowed disabled:opacity-50',
        invalid && 'border-negative/60 focus:border-negative focus:ring-negative/20',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
