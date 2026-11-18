import { redirect } from 'next/navigation';
import { canAccessSection, homeFor, type SectionKey } from '@/components/shell/sections';
import { getOperatorSession } from './current';
import { LOGIN_PATH } from './constants';
import type { OperatorSession } from './session';

export async function requireSection(key: SectionKey): Promise<OperatorSession> {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);
  if (!canAccessSection(operator.role, key)) redirect(homeFor(operator.role));
  return operator;
}

export async function sectionActor(key: SectionKey): Promise<OperatorSession | null> {
  const operator = await getOperatorSession();
  if (!operator) return null;
  return canAccessSection(operator.role, key) ? operator : null;
}
