'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 rounded-xl font-medium',
    'transition-colors duration-200 select-none',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    'disabled:pointer-events-none disabled:opacity-50',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-hover/90',
        secondary: 'border border-border bg-card text-primary hover:bg-elevated',
        ghost: 'text-primary hover:bg-primary/5',
        danger: 'bg-negative text-on-negative hover:bg-negative/90',
        // Спокойный триггер опасного действия (первый шаг двухшагового
        // подтверждения): не кричит красной заливкой, пока действие не взведено.
        'danger-outline':
          'border border-negative/40 bg-transparent text-negative hover:bg-negative/10',
      },
      size: {
        // min-h — touch-target ≥ 44px на всех размерах
        sm: 'min-h-[40px] px-4 text-sm',
        md: 'min-h-[44px] px-5 text-sm',
        lg: 'min-h-[52px] px-7 text-base',
        // Плотные размеры операторского периметра (десктоп, мышь): 32/36px.
        xs: 'h-8 min-h-0 rounded-md px-3 text-[13px]',
        compact: 'h-9 min-h-0 rounded-md px-3.5 text-sm',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <span
          aria-hidden
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
