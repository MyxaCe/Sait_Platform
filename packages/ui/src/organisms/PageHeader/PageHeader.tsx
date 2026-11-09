import type { ElementType, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Breadcrumbs, type Crumb } from '../../molecules/Breadcrumbs/Breadcrumbs';

/**
 * Шапка страницы (концепция §7.1): крошки → заголовок + описание слева,
 * основные действия справа, ниже — опциональная строка `meta` (счётчики,
 * время среза). Одна на страницу; заголовок — единственный h1.
 */
export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: Crumb[];
  linkComponent?: ElementType;
  /** Действия страницы (экспорт, «создать») — справа. */
  actions?: ReactNode;
  /** Строка под заголовком: «Найдено: 15 · срез 22:40». */
  meta?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  linkComponent,
  actions,
  meta,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('space-y-2', className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <Breadcrumbs items={breadcrumbs} linkComponent={linkComponent} />
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1">
          <h1 className="text-primary text-xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="text-secondary max-w-3xl text-sm">{description}</p> : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {meta ? <div className="text-muted text-xs">{meta}</div> : null}
    </header>
  );
}
