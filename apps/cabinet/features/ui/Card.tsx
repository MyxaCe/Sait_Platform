import { cn } from '@broker/ui';

export const CARD = 'rounded-2xl border border-border bg-elevated';

export function Card({
  title,
  titleId,
  count,
  action,
  hint,
  children,
  className,
  bodyClassName,
  flush = false,
  as: Tag = 'section',
  ...rest
}: {
  title?: React.ReactNode;
  titleId?: string;
  count?: React.ReactNode;
  action?: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  flush?: boolean;
  as?: 'section' | 'div' | 'aside';
} & Omit<React.HTMLAttributes<HTMLElement>, 'title'>) {
  const hasHeader = title !== undefined || action !== undefined;
  return (
    <Tag
      className={cn(CARD, 'flex min-w-0 flex-col', className)}
      aria-labelledby={title !== undefined && titleId ? titleId : undefined}
      {...rest}
    >
      {hasHeader ? (
        <div className={cn('flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-4 sm:px-5 sm:pt-5', flush && 'pb-3')}>
          <div className="min-w-0">
            {title !== undefined ? (
              <h2 id={titleId} className="text-[15px] font-semibold">
                {title}
                {count !== undefined ? <span className="ml-1.5 font-normal text-muted">{count}</span> : null}
              </h2>
            ) : null}
            {hint ? <p className="mt-1 text-xs text-secondary">{hint}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div
        className={cn(
          'min-h-0 flex-1',
          flush ? (hasHeader ? 'border-t border-border' : '') : hasHeader ? 'px-4 pb-4 pt-4 sm:px-5 sm:pb-5' : 'p-4 sm:p-5',
          bodyClassName,
        )}
      >
        {children}
      </div>
    </Tag>
  );
}
