import { redirect } from 'next/navigation';
import { localeHref } from '@/i18n/redirect';
import { withNext } from './next-path';
import { getSessionUser, type SessionUser } from './session';

export async function requireSessionUser(locale: string, next: string | null = null): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(withNext(await localeHref('/login', locale), next));
  return user;
}
