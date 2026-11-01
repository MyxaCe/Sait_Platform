'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_SESSION_COOKIE, LOGIN_PATH } from './constants';

/**
 * Выход оператора. Гасит операторскую сессионную куку и уводит на вход. Самого
 * токена-сессии это не «отзывает» (HS256-JWT самодостаточен, Р-394 — он просто
 * протухнет по TTL), но браузер его больше не предъявляет → следующий запрос
 * заворачивает гейт. Серверный экшен, а не `/api`-роут: не заводим новой
 * публичной поверхности (Р-451). CSRF закрывает Next (Origin/Host).
 */
export async function logoutAction(): Promise<void> {
  cookies().delete(ADMIN_SESSION_COOKIE);
  redirect(LOGIN_PATH);
}
