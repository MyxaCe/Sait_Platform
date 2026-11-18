'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_SESSION_COOKIE, LOGIN_PATH } from './constants';

export async function logoutAction(): Promise<void> {
  cookies().delete(ADMIN_SESSION_COOKIE);
  redirect(LOGIN_PATH);
}
