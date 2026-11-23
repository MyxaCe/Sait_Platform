import type { OnboardingResponse } from '@broker/api-client';
import { cmsGet } from '../chrome';
import { getPool } from '../db';
import { parseOnboarding, readOnboardingState, tourEnabled, type OnboardingState } from './state';

/** Тексты экскурсии из CMS. Флаг выключен или CMS не ответила → null: экскурсии нет. */
export async function loadTourConfig(locale: string): Promise<OnboardingResponse | null> {
  if (!tourEnabled()) return null;
  return parseOnboarding(await cmsGet('onboarding', locale));
}

export async function loadOnboardingState(userId: string): Promise<OnboardingState> {
  try {
    const res = await getPool().query('SELECT onboarding FROM users WHERE id = $1', [userId]);
    return readOnboardingState(res.rows[0]?.onboarding);
  } catch (error) {
    console.error('[onboarding] отметки экскурсии не прочитаны:', error);
    return {};
  }
}
