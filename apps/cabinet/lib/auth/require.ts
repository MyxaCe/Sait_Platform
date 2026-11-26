import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from './constants';
import { expiredHref } from './expired';
import { localeHref } from '@/i18n/redirect';
import { withNext } from './next-path';
import { getSessionUser, type SessionUser } from './session';

export async function requireSessionUser(locale: string, next: string | null = null): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    redirect(cookies().has(SESSION_COOKIE) ? expiredHref(locale, next) : withNext(await localeHref('/login', locale), next));
  }
  return user;
}
