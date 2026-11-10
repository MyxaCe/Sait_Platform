import { redirect } from 'next/navigation';
import { canAccessSection, homeFor, type SectionKey } from '@/components/shell/sections';
import { getOperatorSession } from './current';
import { LOGIN_PATH } from './constants';
import type { OperatorSession } from './session';

/**
 * Гейт раздела для layout/страниц (defence in depth поверх middleware):
 * нет сессии → на вход; роль вне матрицы раздела → на «домашнюю» роли.
 */
export async function requireSection(key: SectionKey): Promise<OperatorSession> {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);
  if (!canAccessSection(operator.role, key)) redirect(homeFor(operator.role));
  return operator;
}

/**
 * Гейт раздела для server actions. Action можно вызвать POST-ом на ЛЮБУЮ
 * страницу, поэтому middleware его раздел не определяет — проверка здесь,
 * по той же матрице. `null` — нет сессии или роли нет в разделе (fail-closed).
 */
export async function sectionActor(key: SectionKey): Promise<OperatorSession | null> {
  const operator = await getOperatorSession();
  if (!operator) return null;
  return canAccessSection(operator.role, key) ? operator : null;
}
