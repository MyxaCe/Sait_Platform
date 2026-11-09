import type { ReactNode } from 'react';
import { cn, type StatusTone } from '@broker/ui';

/**
 * Итог проверок в панели решения (концепция §7.4: «статус, итог проверок,
 * формы») — локальный компонент зоны «Клиенты и комплаенс», кандидат в
 * @broker/ui. Строка = что проверено · результат; маркер повторяет форму
 * маркеров словаря статусов (●◆■○) — различимо без цвета.
 */

export interface CheckItem {
  key: string;
  label: ReactNode;
  value: ReactNode;
  tone: StatusTone;
  hint?: ReactNode;
}

const TONE_TEXT: Record<StatusTone, string> = {
  positive: 'text-positive',
  warning: 'text-warning',
  negative: 'text-negative',
  info: 'text-info',
  neutral: 'text-secondary',
};

const MARK: Record<StatusTone, string> = {
  neutral: 'rounded-full border border-current bg-transparent',
  info: 'rounded-full bg-current',
  positive: 'rounded-full bg-current',
  warning: 'rotate-45 rounded-[1px] bg-current',
  negative: 'rounded-[1px] bg-current',
};

export function CheckList({ items, className }: { items: CheckItem[]; className?: string }) {
  return (
    <ul className={cn('divide-y divide-border', className)}>
      {items.map((i) => (
        <li key={i.key} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
          <span className="min-w-0">
            <span className="block text-[13px] text-secondary">{i.label}</span>
            {i.hint ? <span className="block text-xs text-muted">{i.hint}</span> : null}
          </span>
          <span className={cn('flex shrink-0 items-center gap-1.5 text-[13px] font-medium', TONE_TEXT[i.tone])}>
            <span aria-hidden className={cn('size-1.5', MARK[i.tone])} />
            {i.value}
          </span>
        </li>
      ))}
    </ul>
  );
}
