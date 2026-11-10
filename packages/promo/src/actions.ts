/**
 * Коды журнала зоны «Акции и партнёры». Литералами — их находит сторож
 * подписей админки (`apps/admin/lib/journal/labels.test.ts`): у каждого кода
 * обязана быть человекочитаемая подпись.
 */

export const PROMO_ACTIONS = {
  created: 'promo.created',
  updated: 'promo.updated',
  activated: 'promo.activated',
  paused: 'promo.paused',
  ended: 'promo.ended',
  enrolled: 'promo.enrolled',
  expired: 'promo.participation_expired',
  synced: 'promo.queue_synced',
} as const;

export type RewardKind = 'promo' | 'referral' | 'cashback' | 'contest' | 'ib';

export interface RewardActionSet {
  queued: string;
  approved: string;
  credited: string;
  needsReview: string;
  rejected: string;
}

export const REWARD_ACTIONS: Record<RewardKind, RewardActionSet> = {
  promo: {
    queued: 'promo.reward.queued',
    approved: 'promo.reward.approved',
    credited: 'promo.reward.credited',
    needsReview: 'promo.reward.needs_review',
    rejected: 'promo.reward.rejected',
  },
  referral: {
    queued: 'referral.reward.queued',
    approved: 'referral.reward.approved',
    credited: 'referral.reward.credited',
    needsReview: 'referral.reward.needs_review',
    rejected: 'referral.reward.rejected',
  },
  cashback: {
    queued: 'cashback.reward.queued',
    approved: 'cashback.reward.approved',
    credited: 'cashback.reward.credited',
    needsReview: 'cashback.reward.needs_review',
    rejected: 'cashback.reward.rejected',
  },
  contest: {
    queued: 'contest.prize.queued',
    approved: 'contest.prize.approved',
    credited: 'contest.prize.credited',
    needsReview: 'contest.prize.needs_review',
    rejected: 'contest.prize.rejected',
  },
  ib: {
    queued: 'ib.payout.queued',
    approved: 'ib.payout.approved',
    credited: 'ib.payout.credited',
    needsReview: 'ib.payout.needs_review',
    rejected: 'ib.payout.rejected',
  },
};

export const REFERRAL_ACTIONS = {
  attributed: 'referral.attributed',
  rejected: 'referral.attribution_rejected',
  reassigned: 'referral.attribution.reassigned',
  revoked: 'referral.attribution.revoked',
} as const;

export const CONTEST_ACTIONS = {
  joined: 'contest.joined',
  joinFailed: 'contest.join_failed',
  finalized: 'contest.finalized',
} as const;

export const CASHBACK_ACTIONS = {
  accrued: 'cashback.period_accrued',
} as const;

export const IB_ACTIONS = {
  created: 'ib.partner.created',
  updated: 'ib.partner.updated',
  revshareAccrued: 'ib.revshare_accrued',
} as const;

export const PROMO_SETTINGS_ACTION = 'platform.promo_settings.updated';

/** Системный автор переходов движка (миграция 1794800000000). */
export const PROMO_ENGINE_OPERATOR = '00000000-0000-4000-8000-00000000c0b3';
