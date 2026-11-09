import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

/**
 * Многострочное поле — прежде всего «Основание» в формах-с-основанием.
 * Плотное (операторский периметр), утопленный фон `sunken`.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, rows = 2, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(
        'border-border-strong bg-sunken text-primary block w-full rounded-md border px-3 py-2 text-sm',
        'placeholder:text-muted',
        'focus:border-accent/70 focus:ring-accent/20 focus:outline-none focus:ring-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        invalid && 'border-negative/60 focus:border-negative focus:ring-negative/20',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
