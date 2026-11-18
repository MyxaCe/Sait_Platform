import { redirect } from 'next/navigation';
import { getSessionUser, type SessionUser } from './session';

export async function requireSessionUser(locale: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(locale === 'en' ? '/en/login' : '/login');
  return user;
}
