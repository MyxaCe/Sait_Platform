'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readEnv } from '@broker/utils';
import {
  completePasswordReset,
  confirmEmail,
  loadSupportSettings,
  requestEmailVerification,
  requestPasswordReset,
  type LinkBuilder,
} from '@broker/support';
import { getPool } from '../db';
import { hashPassword } from '../auth/password';
import { getSessionUser } from '../auth/session';
import { isRateLimited } from '../rate-limit';
import { supportPool } from './state';

/**
 * Auth-письма кабинета: сброс пароля и подтверждение email (через почту
 * поддержки, SMTP хостинга; письмо уходит воркером из очереди).
 *
 * Ссылка в письме строится ТОЛЬКО от `CABINET_PUBLIC_URL` (адрес ячейки из
 * окружения), никогда от заголовка Host запроса: иначе подменённый Host
 * отправил бы человеку ссылку сброса на чужой домен (reset-link poisoning).
 * Не задан → письмо не ставится (fail-closed), форма отвечает так же, как
 * всегда, а в лог уходит причина.
 */

export interface AuthMailState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

function clientIp(): string | null {
  return headers().get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

function linkBuilder(): LinkBuilder | null {
  const base = readEnv(process.env.CABINET_PUBLIC_URL) ?? readEnv(process.env.NEXT_PUBLIC_SITE_URL);
  if (!base) return null;
  const root = base.replace(/\/+$/, '');
  return (path, token, locale) => `${root}${locale === 'en' ? '/en' : ''}${path}?token=${encodeURIComponent(token)}`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Запрос сброса. Ответ ОДИН И ТОТ ЖЕ для существующего и несуществующего email. */
export async function forgotPasswordAction(_prev: AuthMailState, fd: FormData): Promise<AuthMailState> {
  const email = String(fd.get('email') ?? '').trim();
  if (String(fd.get('website') ?? '')) return { ok: true }; // honeypot
  if (!EMAIL.test(email)) return { fieldErrors: { email: 'invalidEmail' } };
  if (isRateLimited(`forgot:${clientIp() ?? 'local'}`, 10, 60_000)) return { error: 'rateLimited' };
  const link = linkBuilder();
  if (!link) {
    console.error('[auth-mail] CABINET_PUBLIC_URL не задан — письмо сброса не поставлено (fail-closed)');
    return { ok: true };
  }
  const settings = await loadSupportSettings(getPool());
  const r = await requestPasswordReset(supportPool(), settings, { email, ip: clientIp(), link });
  if (r.internal !== 'sent') console.info(`[auth-mail] сброс пароля: ${r.internal}`);
  return { ok: true };
}

export async function resetPasswordAction(_prev: AuthMailState, fd: FormData): Promise<AuthMailState> {
  const token = String(fd.get('token') ?? '');
  const password = String(fd.get('newPassword') ?? '');
  const confirm = String(fd.get('confirmPassword') ?? '');
  if (password.length < 8) return { fieldErrors: { newPassword: 'passwordTooShort' } };
  if (password.length > 200) return { fieldErrors: { newPassword: 'tooLong' } };
  if (password !== confirm) return { fieldErrors: { confirmPassword: 'passwordsMismatch' } };
  if (isRateLimited(`reset:${clientIp() ?? 'local'}`, 10, 60_000)) return { error: 'rateLimited' };
  const r = await completePasswordReset(supportPool(), { token, passwordHash: await hashPassword(password) });
  if (!r.ok) return { error: r.reason };
  const locale = String(fd.get('uiLocale') ?? 'ru');
  redirect(`${locale === 'en' ? '/en' : ''}/login?reset=1`);
}

export async function requestEmailVerifyAction(_prev: AuthMailState): Promise<AuthMailState> {
  const user = await getSessionUser();
  if (!user) return { error: 'unauthorized' };
  const link = linkBuilder();
  if (!link) {
    console.error('[auth-mail] CABINET_PUBLIC_URL не задан — письмо подтверждения не поставлено (fail-closed)');
    return { error: 'mailNotConfigured' };
  }
  const settings = await loadSupportSettings(getPool());
  const r = await requestEmailVerification(supportPool(), settings, { userId: user.id, ip: clientIp(), link });
  if (r === 'sent' || r === 'alreadyVerified') return { ok: true };
  return { error: r };
}

export async function confirmEmailAction(_prev: AuthMailState, fd: FormData): Promise<AuthMailState> {
  const r = await confirmEmail(supportPool(), { token: String(fd.get('token') ?? '') });
  return r.ok ? { ok: true } : { error: r.reason };
}
