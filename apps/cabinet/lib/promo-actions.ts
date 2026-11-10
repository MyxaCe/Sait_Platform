'use server';

import { revalidatePath } from 'next/cache';
import type { PoolLike } from '@broker/money';
import { enrollInPromotion, joinContest, type DemoResetResult } from '@broker/promo';
import { getSessionUser } from './auth/session';
import { getPool } from './db';
import { isRateLimited } from './rate-limit';
import { resetDemoAccount } from './terminal/client';

/**
 * Записи экранов акций: «Участвовать» в акции и в конкурсе. Исход всегда
 * размеченный — форма показывает, что произошло, а не перерисовывается
 * молча (урок WEB-42).
 */

export type EnrollOutcome =
  | { state: 'idle' }
  | { state: 'ok' }
  | { state: 'error'; reason: string }
  | { state: 'too-often' }
  | { state: 'no-session' };

export async function enrollPromotionAction(_prev: EnrollOutcome, formData: FormData): Promise<EnrollOutcome> {
  const user = await getSessionUser();
  if (!user) return { state: 'no-session' };
  if (isRateLimited(`promo-enroll:${user.id}`, 10, 60_000)) return { state: 'too-often' };
  const promotionId = String(formData.get('promotionId') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(promotionId)) return { state: 'error', reason: 'not_found' };
  try {
    const r = await enrollInPromotion(getPool() as unknown as PoolLike, { userId: user.id, promotionId });
    if (!r.ok) return { state: 'error', reason: r.reason };
  } catch (error) {
    console.error('[promo] вступление не записано', error);
    return { state: 'error', reason: 'unavailable' };
  }
  revalidatePath('/', 'layout');
  return { state: 'ok' };
}

export type JoinContestOutcome =
  | { state: 'idle' }
  | { state: 'ok' }
  | { state: 'error'; reason: string; detail?: string | null }
  | { state: 'too-often' }
  | { state: 'no-session' };

/** Сброс демо для конкурса — кабинетный `resetDemoAccount` (тот же, что на главной). */
async function resetForContest(userId: string): Promise<DemoResetResult> {
  const out = await resetDemoAccount(userId);
  if (out.state === 'accepted') return { state: 'accepted' };
  if (out.state === 'refused') return { state: 'refused', reason: out.reason ?? out.raw };
  return { state: 'unavailable', reason: out.reason };
}

export async function joinContestAction(_prev: JoinContestOutcome, formData: FormData): Promise<JoinContestOutcome> {
  const user = await getSessionUser();
  if (!user) return { state: 'no-session' };
  if (isRateLimited(`contest-join:${user.id}`, 5, 60_000)) return { state: 'too-often' };
  const promotionId = String(formData.get('promotionId') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(promotionId)) return { state: 'error', reason: 'not_found' };
  try {
    const r = await joinContest(getPool() as unknown as PoolLike, { userId: user.id, promotionId }, resetForContest);
    if (!r.ok) return { state: 'error', reason: r.reason, detail: r.detail ?? null };
  } catch (error) {
    console.error('[contest] вступление не записано', error);
    return { state: 'error', reason: 'unavailable' };
  }
  revalidatePath('/', 'layout');
  return { state: 'ok' };
}
