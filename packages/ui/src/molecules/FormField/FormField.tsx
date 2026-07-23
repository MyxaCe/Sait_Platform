import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface FormFieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/** Обёртка поля формы: label + контрол + ошибка/подсказка. */
export function FormField({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: FormFieldProps) {
  return (
    <div className={cn('flex flex-col', className)}>
      <label htmlFor={htmlFor} className="mb-2 text-sm text-secondary">
        {label}
        {required && (
          <span aria-hidden className="ml-0.5 text-negative">
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-negative">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-secondary/80">{hint}</p>
      ) : null}
    </div>
  );
}
