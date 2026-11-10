/**
 * external_ref начислений — ОДНА форма на всю платформу (идемпотентность у
 * терминала: повтор того же ref = та же проводка). Длина ≤ 200 (контракт).
 *
 * Кешбэк несёт id акции: две программы кешбэка в одном месяце не должны
 * делить один ref (иначе вторая молча стала бы «повтором» первой).
 */
export const rewardRef = {
  promo: (promotionId: string, userId: string) => `promo:${promotionId}:${userId}`,
  referral: (friendUserId: string, role: 'referrer' | 'referee') => `ref:${friendUserId}:${role}`,
  cashback: (promotionId: string, period: string, userId: string) => `cashback:${promotionId}:${period}:${userId}`,
  contest: (promotionId: string, place: number) => `contest:${promotionId}:${place}`,
  ibCpa: (clientUserId: string) => `ib:cpa:${clientUserId}`,
  ibRevshare: (partnerId: string, period: string) => `ib:rev:${partnerId}:${period}`,
};
