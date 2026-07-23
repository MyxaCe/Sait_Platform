'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export type CheckboxProps = InputHTMLAttributes<HTMLInputElement>;

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        'size-5 shrink-0 cursor-pointer rounded border-border bg-card accent-accent',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        className,
      )}
      {...props}
    />
  ),
);
Checkbox.displayName = 'Checkbox';
