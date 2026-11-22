import { cookies } from 'next/headers';
import { ADMIN_SESSION_COOKIE } from './constants';
import { verifyOperatorSession, type OperatorSession } from './session';

export async function getOperatorSession(): Promise<OperatorSession | null> {
  const token = cookies().get(ADMIN_SESSION_COOKIE)?.value;
  return verifyOperatorSession(token);
}
