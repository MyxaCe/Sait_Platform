import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Тон статуса — ЕДИНАЯ семантика цвета для всех доменов (концепция §5):
 *
 *  - `positive` — завершено успешно / в норме: KYC подтверждён, AML чисто,
 *    депозит зачислен, вывод исполнен.
 *  - `warning`  — ждёт решения ОПЕРАТОРА: KYC на проверке, вывод подан или на
 *    ручной проверке, AML не сверялся, неопознанное поступление.
 *  - `info`     — в процессе у ДРУГОЙ стороны (клиент, сеть, терминал):
 *    переподача запрошена, депозит ждёт сети, вывод одобрен/отправлен.
 *  - `negative` — отказ/риск/ограничение: отклонён, эскалация AML, блокировка,
 *    заморозка, запрет вывода.
 *  - `neutral`  — инертное/завершено без результата: не подавал, черновик, отменено.
 *
 * Цвет никогда не единственный носитель смысла: у бейджа всегда есть подпись,
 * а у тона — форма маркера (DOT) для различимости без цвета.
 */
export type StatusTone = 'neutral' | 'info' | 'positive' | 'warning' | 'negative';

/**
 * Единый словарь состояний → тон/подпись. ОДИН источник соответствия статуса и
 * цвета для всех операторских экранов. Добавлять состояние — здесь, в одной
 * строке. Ключи без префикса — исторические (KYC и денежные команды Р-452),
 * остальные — с префиксом домена, чтобы одинаковые слова разных доменов не
 * склеивались (`rejected` KYC ≠ `deposit_rejected`).
 */
export const STATUS_DICTIONARY = {
  // Верификация (client_verification.state)
  unverified: { tone: 'neutral', label: 'Не подавал' },
  pending: { tone: 'warning', label: 'На проверке' },
  verified: { tone: 'positive', label: 'Подтверждён' },
  rejected: { tone: 'negative', label: 'Отклонён' },
  resubmit_requested: { tone: 'info', label: 'Переподача' },
  // AML-скрининг (client_aml_screening.status)
  aml_unscreened: { tone: 'warning', label: 'AML: не сверялся' },
  aml_clear: { tone: 'positive', label: 'AML: чисто' },
  aml_escalated: { tone: 'negative', label: 'AML: эскалация' },
  // Доступ клиента
  active: { tone: 'positive', label: 'Активен' },
  blocked: { tone: 'negative', label: 'Заблокирован' },
  frozen: { tone: 'negative', label: 'Счёт заморожен' },
  withdraw_banned: { tone: 'negative', label: 'Вывод запрещён' },
  // Депозит USDT (crypto_deposits.status)
  deposit_claimed: { tone: 'info', label: 'Ждёт сети' },
  deposit_credited: { tone: 'positive', label: 'Зачислен' },
  deposit_rejected: { tone: 'negative', label: 'Отклонён' },
  deposit_unidentified: { tone: 'warning', label: 'Неопознанный' },
  // Вывод USDT (crypto_withdrawals.status)
  withdrawal_requested: { tone: 'warning', label: 'Подана' },
  withdrawal_needs_review: { tone: 'warning', label: 'На проверке' },
  withdrawal_approved: { tone: 'info', label: 'Одобрена' },
  withdrawal_sent: { tone: 'info', label: 'Отправлена' },
  withdrawal_settled: { tone: 'positive', label: 'Исполнена' },
  withdrawal_rejected: { tone: 'negative', label: 'Отклонена' },
  withdrawal_cancelled: { tone: 'neutral', label: 'Отменена' },
  // Денежная операция (Р-452)
  draft: { tone: 'neutral', label: 'Черновик' },
  awaiting_second: { tone: 'warning', label: 'Ждёт 2-го' },
  executed: { tone: 'positive', label: 'Исполнено' },
  money_rejected: { tone: 'negative', label: 'Отклонено' },
  break_glass: { tone: 'negative', label: 'Break-glass' },
} as const satisfies Record<string, { tone: StatusTone; label: string }>;

export type StatusKey = keyof typeof STATUS_DICTIONARY;

/** Безопасный доступ по строке из БД: неизвестный статус → `undefined`. */
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

/** Форма маркера: различимость без цвета (дальтонизм, ч/б печать). */
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
  /** Без маркера (в плотных местах, где тон и так ясен). */
  plain?: boolean;
  className?: string;
}

/** Бейдж произвольного текста в одном из тонов (для меток вне словаря). */
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
  /** Переопределить подпись из словаря (тон остаётся из словаря). */
  label?: string;
  plain?: boolean;
  className?: string;
}

/** Статус-бейдж: фиксированная карта состояний → тон/подпись. */
export function StatusBadge({ status, label, plain, className }: StatusBadgeProps) {
  const entry = STATUS_DICTIONARY[status];
  return (
    <ToneBadge tone={entry.tone} plain={plain} className={className}>
      {label ?? entry.label}
    </ToneBadge>
  );
}
