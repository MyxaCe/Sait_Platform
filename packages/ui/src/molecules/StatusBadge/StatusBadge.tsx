import { Badge } from '../../atoms/Badge/Badge';
import { cn } from '../../lib/cn';

type BadgeVariant = 'accent' | 'neutral' | 'positive' | 'negative';

/**
 * Единый словарь состояний → вариант/подпись (§5.3 п.2). ОДИН источник
 * соответствия статуса и цвета для всех операторских экранов — как
 * `ConnectionDot` для соединения. Добавлять состояние — здесь, в одной строке.
 *
 * Покрывает верификацию (ADM-08/ADM-10) и денежные операции (Р-452). Денежный
 * `rejected` назван `money_rejected`, чтобы не путать с KYC-`rejected` (разные
 * домены, одна карта).
 */
export const STATUS_DICTIONARY = {
  // Верификация (client_verification.state)
  unverified: { variant: 'neutral', label: 'Не подавал' },
  pending: { variant: 'accent', label: 'Ожидает' },
  verified: { variant: 'positive', label: 'Подтверждён' },
  rejected: { variant: 'negative', label: 'Отклонён' },
  resubmit_requested: { variant: 'accent', label: 'Переподача' },
  // Денежная операция (Р-452)
  draft: { variant: 'neutral', label: 'Черновик' },
  awaiting_second: { variant: 'accent', label: 'Ждёт 2-го' },
  executed: { variant: 'positive', label: 'Исполнено' },
  money_rejected: { variant: 'negative', label: 'Отклонено' },
  break_glass: { variant: 'negative', label: 'Break-glass' },
} as const satisfies Record<string, { variant: BadgeVariant; label: string }>;

export type StatusKey = keyof typeof STATUS_DICTIONARY;

export interface StatusBadgeProps {
  status: StatusKey;
  /** Переопределить подпись из словаря (вариант-цвет остаётся из словаря). */
  label?: string;
  className?: string;
}

/**
 * Статус-бейдж: обёртка над `Badge` с фиксированной картой состояний. Плотный
 * (мельче витринного `Badge`) — под строки таблиц-очередей.
 */
export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const entry = STATUS_DICTIONARY[status];
  return (
    <Badge
      variant={entry.variant}
      className={cn('px-2 py-0.5 text-xs uppercase tracking-wide', className)}
    >
      {label ?? entry.label}
    </Badge>
  );
}
