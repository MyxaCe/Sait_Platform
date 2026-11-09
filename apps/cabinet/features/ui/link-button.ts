import { cn } from '@broker/ui';

/**
 * Ссылка, выглядящая как кнопка (переход, не действие) — те же размеры и
 * цвета, что у `Button` из @broker/ui (концепция §6.5). Высота 44 px — цель
 * касания на телефоне. Текст на акценте — `text-on-accent` (AA, аудит К9).
 */
export function linkButton(variant: 'primary' | 'secondary' = 'secondary', className?: string): string {
  return cn(
    'inline-flex min-h-[44px] items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-medium transition-colors',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    variant === 'primary'
      ? 'bg-accent text-on-accent hover:bg-accent-hover'
      : 'border border-border-strong bg-card text-primary hover:bg-primary/5',
    className,
  );
}
