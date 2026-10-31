import { cookies } from 'next/headers';
import { ADMIN_SESSION_COOKIE } from './constants';
import { verifyOperatorSession, type OperatorSession } from './session';

/**
 * Оператор текущего запроса или `null`. Для серверных компонентов защищённой
 * зоны (читает куку через `next/headers`, поэтому НЕ edge — отдельный файл от
 * `session.ts`, который должен оставаться edge-совместимым для middleware).
 */
export async function getOperatorSession(): Promise<OperatorSession | null> {
  const token = cookies().get(ADMIN_SESSION_COOKIE)?.value;
  return verifyOperatorSession(token);
}
