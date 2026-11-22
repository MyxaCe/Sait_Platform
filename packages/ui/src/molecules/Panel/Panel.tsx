import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface PanelProps {
  title?: ReactNode;
  count?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  flush?: boolean;
  tone?: 'default' | 'danger';
  id?: string;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}

export function Panel({
  title,
  count,
  description,
  actions,
  footer,
  flush = false,
  tone = 'default',
  id,
  className,
  bodyClassName,
  children,
}: PanelProps) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={title && headingId ? headingId : undefined}
      className={cn(
        'bg-card min-w-0 overflow-hidden rounded-lg border',
        tone === 'danger' ? 'border-negative/30' : 'border-border',
        className,
      )}
    >
      {title || actions ? (
        <header
          className={cn(
            'flex min-h-[48px] items-center justify-between gap-3 border-b px-4 py-2.5',
            tone === 'danger' ? 'border-negative/25 bg-negative/[0.04]' : 'border-border',
          )}
        >
          <div className="min-w-0">
            {title ? (
              <h2
                id={headingId}
                className="text-primary flex items-center gap-2 text-sm font-semibold"
              >
                {title}
                {count != null ? (
                  <span className="bg-primary/[0.07] text-secondary rounded px-1.5 text-xs font-medium tabular-nums">
                    {count}
                  </span>
                ) : null}
              </h2>
            ) : null}
            {description ? <p className="text-muted mt-0.5 text-xs">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn(!flush && 'p-4', bodyClassName)}>{children}</div>
      {footer ? (
        <footer className="border-border text-muted border-t px-4 py-2.5 text-xs">{footer}</footer>
      ) : null}
    </section>
  );
}
