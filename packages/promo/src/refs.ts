export const rewardRef = {
  promo: (promotionId: string, userId: string) => `promo:${promotionId}:${userId}`,
  referral: (friendUserId: string, role: 'referrer' | 'referee') => `ref:${friendUserId}:${role}`,
  cashback: (promotionId: string, period: string, userId: string) => `cashback:${promotionId}:${period}:${userId}`,
  contest: (promotionId: string, place: number) => `contest:${promotionId}:${place}`,
  ibCpa: (clientUserId: string) => `ib:cpa:${clientUserId}`,
  ibRevshare: (partnerId: string, period: string) => `ib:rev:${partnerId}:${period}`,
};
