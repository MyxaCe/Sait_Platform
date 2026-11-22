import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface DescriptionItem {
  term: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'negative' | 'warning' | 'positive';
  numeric?: boolean;
  wide?: boolean;
}

const TONE: Record<NonNullable<DescriptionItem['tone']>, string> = {
  default: 'text-primary',
  negative: 'text-negative',
  warning: 'text-warning',
  positive: 'text-positive',
};

const COLS: Record<1 | 2 | 3 | 4, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
};

export interface DescriptionListProps {
  items: DescriptionItem[];
  columns?: 1 | 2 | 3 | 4;
  className?: string;
}

export function DescriptionList({ items, columns = 2, className }: DescriptionListProps) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-4', COLS[columns], className)}>
      {items.map((item, i) => (
        <div key={i} className={cn('min-w-0', item.wide && 'col-span-full')}>
          <dt className="text-muted text-xs">{item.term}</dt>
          <dd
            className={cn(
              'mt-0.5 text-sm',
              TONE[item.tone ?? 'default'],
              item.numeric && 'tabular-nums',
            )}
          >
            {item.value}
          </dd>
          {item.hint ? <dd className="text-muted text-xs">{item.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
