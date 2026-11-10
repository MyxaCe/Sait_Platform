import { useLocale, useTranslations } from 'next-intl';
import { EmptyState, Money, ToneBadge, type StatusTone } from '@broker/ui';
import type { ClientRewardStatus, RewardView } from '@broker/promo';
import { realMoneyCurrency } from '@broker/money/display-currency';
import { formatDate, formatPeriod } from './format';

export const REWARD_TONE: Record<ClientRewardStatus, StatusTone> = {
  processing: 'warning',
  credited: 'positive',
  rejected: 'negative',
};

/**
 * «Мои начисления»: три состояния для клиента — в обработке / зачислено /
 * отклонено (с причиной оператора). Сумма — в валюте начисления.
 */
export function RewardList({ rewards }: { rewards: RewardView[] }) {
  const t = useTranslations('promo');
  const locale = useLocale();
  if (rewards.length === 0) {
    return <EmptyState size="compact" title={t('rewardsEmpty')} />;
  }
  return (
    <ul className="divide-y divide-border" data-testid="rewards">
      {rewards.map((r) => {
        const period = formatPeriod(r.period, locale);
        const title = r.promotionTitle ?? t(`rewardKind.${r.kind}`);
        return (
          <li key={r.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0" data-status={r.status}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-primary">{title}</p>
                <p className="text-xs text-muted">
                  {t(`rewardKind.${r.kind}`)}
                  {period ? ` · ${period}` : ''}
                  {' · '}
                  {r.status === 'credited' && r.creditedAt
                    ? t('rewardCredited', { date: formatDate(r.creditedAt, locale) ?? '—' })
                    : t('rewardCreated', { date: formatDate(r.createdAt, locale) ?? '—' })}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Money
                  minor={r.amountMinor}
                  currency={realMoneyCurrency(r.currency)}
                  signed={r.status === 'credited'}
                  className={r.status === 'rejected' ? 'text-sm text-muted line-through' : 'text-sm font-semibold'}
                />
                <ToneBadge tone={REWARD_TONE[r.status]}>{t(`rewardStatus.${r.status}`)}</ToneBadge>
              </div>
            </div>
            {r.status === 'rejected' && r.rejectReason ? (
              <p className="rounded-lg bg-negative/[0.06] px-3 py-2 text-xs text-secondary">
                {t('rewardReason', { reason: r.rejectReason })}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
