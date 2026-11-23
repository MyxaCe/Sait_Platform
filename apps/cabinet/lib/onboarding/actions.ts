'use server';

import { ONBOARDING_PARTS, type OnboardingPart } from '@broker/api-client';
import { getSessionUser } from '../auth/session';
import { getPool } from '../db';
import type { TourStatus } from './state';

/**
 * Отметка «часть экскурсии пройдена / пропущена». Пишет только свою строку
 * текущего клиента. Показанная часть больше сама не откроется (только по «?»).
 */
export async function saveTourResultAction(part: OnboardingPart, version: number, status: TourStatus): Promise<boolean> {
  if (!(ONBOARDING_PARTS as readonly string[]).includes(part)) return false;
  if (!Number.isInteger(version) || version < 1 || version > 1_000_000) return false;
  if (status !== 'done' && status !== 'skipped') return false;
  const user = await getSessionUser();
  if (!user) return false;
  try {
    await getPool().query(
      `UPDATE users
          SET onboarding = jsonb_set(onboarding, ARRAY[$2::text], jsonb_build_object('v', $3::int, 's', $4::text), true)
        WHERE id = $1`,
      [user.id, part, version, status],
    );
    return true;
  } catch (error) {
    console.error('[onboarding] отметка экскурсии не сохранена:', error);
    return false;
  }
}
