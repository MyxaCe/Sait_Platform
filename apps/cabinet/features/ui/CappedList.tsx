import { useTranslations } from 'next-intl';
import { cn } from '@broker/ui';

/**
 * Список карточки без обрезанных строк: первые `limit` строк видны целиком, остальные — под
 * «Показать все (N)». Строка никогда не режется посередине (в отличие от прокрутки в фиксированной высоте).
 */
export function CappedList({
  items,
  limit,
  className,
  testId,
}: {
  items: React.ReactNode[];
  limit: number;
  className?: string;
  testId?: string;
}) {
  const t = useTranslations('common');
  const head = items.slice(0, limit);
  const rest = items.slice(limit);
  return (
    <div className={className} data-testid={testId}>
      <ul className="divide-y divide-border">{head}</ul>
      {rest.length > 0 ? (
        <details className="group border-t border-border">
          <summary className="flex cursor-pointer list-none items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium text-accent hover:bg-primary/[0.03] [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">{t('showAll', { n: items.length })}</span>
            <span className="hidden group-open:inline">{t('showLess')}</span>
          </summary>
          <ul className={cn('divide-y divide-border border-t border-border')}>{rest}</ul>
        </details>
      ) : null}
    </div>
  );
}
