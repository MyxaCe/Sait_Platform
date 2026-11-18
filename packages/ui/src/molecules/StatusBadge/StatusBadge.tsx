import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type StatusTone = 'neutral' | 'info' | 'positive' | 'warning' | 'negative';

export const STATUS_DICTIONARY = {
  unverified: { tone: 'neutral', label: 'Не подавал' },
  pending: { tone: 'warning', label: 'На проверке' },
  verified: { tone: 'positive', label: 'Подтверждён' },
  rejected: { tone: 'negative', label: 'Отклонён' },
  resubmit_requested: { tone: 'info', label: 'Переподача' },
  aml_unscreened: { tone: 'warning', label: 'AML: не сверялся' },
  aml_clear: { tone: 'positive', label: 'AML: чисто' },
  aml_escalated: { tone: 'negative', label: 'AML: эскалация' },
  active: { tone: 'positive', label: 'Активен' },
  blocked: { tone: 'negative', label: 'Заблокирован' },
  frozen: { tone: 'negative', label: 'Счёт заморожен' },
  withdraw_banned: { tone: 'negative', label: 'Вывод запрещён' },
  deposit_claimed: { tone: 'info', label: 'Ждёт сети' },
  deposit_credited: { tone: 'positive', label: 'Зачислен' },
  deposit_rejected: { tone: 'negative', label: 'Отклонён' },
  deposit_unidentified: { tone: 'warning', label: 'Неопознанный' },
  withdrawal_requested: { tone: 'warning', label: 'Подана' },
  withdrawal_needs_review: { tone: 'warning', label: 'На проверке' },
  withdrawal_approved: { tone: 'info', label: 'Одобрена' },
  withdrawal_sent: { tone: 'info', label: 'Отправлена' },
  withdrawal_settled: { tone: 'positive', label: 'Исполнена' },
  withdrawal_rejected: { tone: 'negative', label: 'Отклонена' },
  withdrawal_cancelled: { tone: 'neutral', label: 'Отменена' },
  draft: { tone: 'neutral', label: 'Черновик' },
  awaiting_second: { tone: 'warning', label: 'Ждёт 2-го' },
  executed: { tone: 'positive', label: 'Исполнено' },
  money_rejected: { tone: 'negative', label: 'Отклонено' },
  break_glass: { tone: 'negative', label: 'Break-glass' },
  support_new: { tone: 'warning', label: 'Новое' },
  support_open: { tone: 'warning', label: 'В работе' },
  support_waiting_client: { tone: 'info', label: 'Ждём клиента' },
  support_waiting_internal: { tone: 'info', label: 'Эскалация' },
  support_resolved: { tone: 'positive', label: 'Решено' },
  support_closed: { tone: 'neutral', label: 'Закрыто' },
  support_spam: { tone: 'negative', label: 'Спам' },
  mail_queued: { tone: 'info', label: 'В очереди' },
  mail_sending: { tone: 'info', label: 'Отправляется' },
  mail_sent: { tone: 'positive', label: 'Отправлено' },
  mail_failed: { tone: 'negative', label: 'Не доставлено' },
  mail_cancelled: { tone: 'neutral', label: 'Отменено' },
} as const satisfies Record<string, { tone: StatusTone; label: string }>;

export type StatusKey = keyof typeof STATUS_DICTIONARY;

export function statusKeyOf(value: string): StatusKey | undefined {
  return Object.prototype.hasOwnProperty.call(STATUS_DICTIONARY, value)
    ? (value as StatusKey)
    : undefined;
}

const TONE: Record<StatusTone, string> = {
  neutral: 'bg-primary/[0.06] text-secondary ring-border-strong',
  info: 'bg-info/10 text-info ring-info/25',
  positive: 'bg-positive/10 text-positive ring-positive/25',
  warning: 'bg-warning/10 text-warning ring-warning/25',
  negative: 'bg-negative/10 text-negative ring-negative/25',
};

const DOT: Record<StatusTone, string> = {
  neutral: 'rounded-full border border-current bg-transparent',
  info: 'rounded-full bg-current',
  positive: 'rounded-full bg-current',
  warning: 'rotate-45 rounded-[1px] bg-current',
  negative: 'rounded-[1px] bg-current',
};

export interface ToneBadgeProps {
  tone: StatusTone;
  children: ReactNode;
  plain?: boolean;
  className?: string;
}

export function ToneBadge({ tone, children, plain = false, className }: ToneBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium ring-1 ring-inset',
        TONE[tone],
        className,
      )}
    >
      {plain ? null : <span aria-hidden className={cn('size-1.5 shrink-0', DOT[tone])} />}
      {children}
    </span>
  );
}

export interface StatusBadgeProps {
  status: StatusKey;
  label?: string;
  plain?: boolean;
  className?: string;
}

export function StatusBadge({ status, label, plain, className }: StatusBadgeProps) {
  const entry = STATUS_DICTIONARY[status];
  return (
    <ToneBadge tone={entry.tone} plain={plain} className={className}>
      {label ?? entry.label}
    </ToneBadge>
  );
}
