'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  completeForcedPasswordChange,
  completePasswordReset,
  confirmEmail,
  loadSupportSettings,
  requestActivationLink,
  requestEmailVerification,
  requestPasswordReset,
} from '@broker/support';
import { getPool } from '../db';
import { hashPassword } from '../auth/password';
import { createSession, getSessionUser, hashToken } from '../auth/session';
import { safeNext } from '../auth/next-path';
import { clearPendingActivation, readPendingActivation } from '../auth/pending-activation-cookie';
import { SESSION_COOKIE } from '../auth/constants';
import { isRateLimited } from '../rate-limit';
import { supportPool } from './state';
import { localeHref } from '@/i18n/redirect';
import { authLinkBuilder } from './auth-link';

export interface AuthMailState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

function clientIp(): string | null {
  return headers().get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

const linkBuilder = authLinkBuilder;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function forgotPasswordAction(_prev: AuthMailState, fd: FormData): Promise<AuthMailState> {
  const email = String(fd.get('email') ?? '').trim();
  if (String(fd.get('website') ?? '')) return { ok: true };
  if (!EMAIL.test(email)) return { fieldErrors: { email: 'invalidEmail' } };
  if (isRateLimited(`forgot:${clientIp() ?? 'local'}`, 10, 60_000)) return { error: 'rateLimited' };
  const link = await linkBuilder();
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
  redirect(await localeHref('/login?reset=1', locale));
}

export async function requestEmailVerifyAction(_prev: AuthMailState): Promise<AuthMailState> {
  const user = await getSessionUser();
  if (!user) return { error: 'unauthorized' };
  const link = await linkBuilder();
  if (!link) {
    console.error('[auth-mail] CABINET_PUBLIC_URL не задан — письмо подтверждения не поставлено (fail-closed)');
    return { error: 'mailNotConfigured' };
  }
  const settings = await loadSupportSettings(getPool());
  const r = await requestEmailVerification(supportPool(), settings, { userId: user.id, ip: clientIp(), link });
  if (r === 'sent' || r === 'alreadyVerified') return { ok: true };
  return { error: r };
}

/**
 * Ссылка из письма подтверждения. Первое подтверждение активирует учётную запись и сразу
 * впускает в кабинет: письмо пришло на этот адрес — владелец доказан. Исключение —
 * клиент с включённой 2FA (подтверждение нового адреса после смены оператором): ссылка не
 * заменяет второй фактор, такой клиент входит обычным порядком.
 *
 * Повторное нажатие (двойной клик, вторая вкладка) приходит с уже использованным токеном:
 * если сессия уже выдана — просто в кабинет, иначе понятное «ссылка уже использована».
 */
export async function confirmEmailAction(_prev: AuthMailState, fd: FormData): Promise<AuthMailState> {
  if (isRateLimited(`confirm:${clientIp() ?? 'local'}`, 20, 60_000)) return { error: 'rateLimited' };
  const locale = String(fd.get('uiLocale') ?? 'ru');
  const r = await confirmEmail(supportPool(), { token: String(fd.get('token') ?? '') });
  if (!r.ok) {
    if (r.reason === 'usedToken' && (await getSessionUser())) redirect(await localeHref('/', locale));
    return { error: r.reason };
  }
  const pending = readPendingActivation();
  clearPendingActivation();
  if (r.activatedNow && !r.twoFactor) {
    await getPool().query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [r.userId]);
    await createSession(r.userId);
    redirect(safeNext(pending?.next ?? null) ?? (await localeHref('/', locale)));
  }
  return { ok: true };
}

/**
 * «Отправить письмо ещё раз» с экрана «Проверьте почту» и со входа. Адрес — из cookie
 * ожидающей регистрации, не из формы. Ответ не зависит от того, есть ли такой адрес:
 * интервал и лимит считаются одинаково для любого адреса.
 */
export async function resendActivationAction(_prev: AuthMailState, fd: FormData): Promise<AuthMailState> {
  if (String(fd.get('website') ?? '')) return { ok: true };
  if (isRateLimited(`activation:${clientIp() ?? 'local'}`, 10, 60_000)) return { error: 'rateLimited' };
  const pending = readPendingActivation();
  if (!pending) return { error: 'noPending' };
  const link = await linkBuilder();
  if (!link) {
    console.error('[auth-mail] CABINET_PUBLIC_URL не задан — повторная ссылка подтверждения не поставлена (fail-closed)');
    return { error: 'mailNotConfigured' };
  }
  const settings = await loadSupportSettings(getPool());
  const r = await requestActivationLink(supportPool(), settings, { email: pending.email, ip: clientIp(), link });
  if (r.internal !== 'sent') console.info(`[auth-mail] повторная ссылка подтверждения: ${r.internal}`);
  if (r.internal === 'tooSoon') return { error: 'tooSoon' };
  if (r.internal === 'rateLimited') return { error: 'rateLimited' };
  return { ok: true };
}

export async function forcedPasswordChangeAction(_prev: AuthMailState, fd: FormData): Promise<AuthMailState> {
  const user = await getSessionUser();
  if (!user) return { error: 'unauthorized' };
  const password = String(fd.get('newPassword') ?? '');
  const confirm = String(fd.get('confirmPassword') ?? '');
  if (password.length < 8) return { fieldErrors: { newPassword: 'passwordTooShort' } };
  if (password.length > 200) return { fieldErrors: { newPassword: 'tooLong' } };
  if (password !== confirm) return { fieldErrors: { confirmPassword: 'passwordsMismatch' } };
  if (isRateLimited(`forced:${user.id}`, 10, 60_000)) return { error: 'rateLimited' };
  const token = cookies().get(SESSION_COOKIE)?.value ?? null;
  await completeForcedPasswordChange(supportPool(), {
    userId: user.id,
    passwordHash: await hashPassword(password),
    keepSessionTokenHash: token ? hashToken(token) : null,
  });
  redirect(await localeHref('/', user.locale));
}
