'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_TOTP_CHALLENGE_COOKIE,
} from './auth/constants';
import { verifyOperatorCredentials } from './auth/login';
import { verifyOperatorTotpStep } from './auth/operator-totp';
import type { OperatorSession } from './auth/session';
import { issueOperatorSessionToken, SESSION_TTL_SECONDS } from './auth/session';
import {
  issueTotpChallenge,
  TOTP_CHALLENGE_TTL_SECONDS,
  verifyTotpChallenge,
} from './auth/totp-challenge';
import { appendJournalEntry } from './journal/journal';
import { isRateLimited } from './rate-limit';

/**
 * Серверный экшен входа оператора (ADM-01 + ADM-13, Р-451, Р-454 III-3).
 *
 * **Почему server action на публичной `/login`, а не ручка `/api/login`.**
 * `/login` уже публичная страница, а server action — это POST в её же роут:
 * никакой НОВОЙ публичной поверхности `/api` не заводится (Р-451, default-deny
 * на `/api` сохраняется). CSRF у server actions закрывает Next (Origin/Host).
 *
 * **Два шага (ADM-13).** Фаза определяется по `prev.step`, НЕ по форме (форма
 * не оракул):
 *  1. логин+пароль. Пароль неверен/логина нет/отключён → общий отказ (Р-451).
 *     Пароль верен и 2FA включена → выдаём CHALLENGE-куку (identity второго
 *     шага, не сессия), возвращаем `{ step: 'totp' }` — сессии ещё нет. 2FA НЕ
 *     включена → сессия выдаётся сразу (защищённая зона принудит к регистрации
 *     TOTP — суперадмин «с первого дня», без тихого обхода).
 *  2. код TOTP. Личность берётся из CHALLENGE-куки, код проверяется с окном ±1
 *     (Р-454). Неверный/битый код → общий отказ, остаёмся на шаге TOTP
 *     (fail-closed; личность и факт 2FA не раскрываем, секрет — тем более).
 *
 * `operator.login` в журнал пишется ТОЛЬКО при полном успехе (оба фактора).
 *
 * Контракт с формой: `{ error?, step? }`. Успех — redirect на `/` (throw).
 */

export interface LoginState {
  error?: string;
  /** `'totp'` — форма переходит ко второму шагу (ввод кода). */
  step?: 'totp';
}

function clientIp(): string {
  return headers().get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}

/**
 * Завершение входа: журнал ДО выдачи сессии (сбой журнала = тихий вход без
 * следа → отказываем, Р-049), затем сессионная кука и redirect. Общая концовка
 * обоих путей (с 2FA и без).
 */
async function finishLogin(session: OperatorSession): Promise<LoginState> {
  try {
    await appendJournalEntry({
      operatorId: session.operatorId,
      action: 'operator.login',
      subjectKind: 'operator',
      subjectId: session.operatorId,
      payload: { login: session.login, ip: clientIp() },
    });
  } catch (error) {
    console.error(`[admin-login] не удалось записать вход в журнал (login=${session.login})`, error);
    return { error: 'invalidCredentials' };
  }

  const token = await issueOperatorSessionToken(session);
  cookies().set(ADMIN_SESSION_COOKIE, token, cookieOptions(SESSION_TTL_SECONDS));
  redirect('/');
}

export async function loginAction(prev: LoginState, formData: FormData): Promise<LoginState> {
  const inTotpStep = prev.step === 'totp';

  // Брутфорс по IP тормозим до базы и до argon2/HMAC. На шаге TOTP сохраняем
  // шаг, чтобы форма не откатилась к паролю.
  if (isRateLimited(`admin-login:${clientIp()}`, 10, 60_000)) {
    return inTotpStep ? { error: 'rateLimited', step: 'totp' } : { error: 'rateLimited' };
  }

  if (inTotpStep) {
    // Фаза 2: второй фактор. Личность — из CHALLENGE-куки, не из формы.
    const operatorId = await verifyTotpChallenge(cookies().get(ADMIN_TOTP_CHALLENGE_COOKIE)?.value);
    if (!operatorId) {
      // Тикет истёк/подделан — начинаем заново с пароля (fail-closed).
      cookies().delete(ADMIN_TOTP_CHALLENGE_COOKIE);
      return { error: 'invalidCredentials' };
    }
    const code = String(formData.get('code') ?? '');
    const result = await verifyOperatorTotpStep(operatorId, code);
    if (!result.ok) {
      // Неверный код — общий отказ, остаёмся на шаге TOTP (тикет ещё жив).
      return { error: 'invalidCredentials', step: 'totp' };
    }
    cookies().delete(ADMIN_TOTP_CHALLENGE_COOKIE);
    return finishLogin(result.session);
  }

  // Фаза 1: пароль. Чистим возможный несвежий CHALLENGE от прерванного входа.
  cookies().delete(ADMIN_TOTP_CHALLENGE_COOKIE);

  const login = String(formData.get('login') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!login || !password) {
    // Пустые поля — та же общая ошибка: форма не оракул (Р-451).
    return { error: 'invalidCredentials' };
  }

  const result = await verifyOperatorCredentials(login, password);
  if (!result.ok) {
    // Общая ошибка без перечисления: не выдаём, существует ли логин (Р-451).
    return { error: 'invalidCredentials' };
  }

  if (result.totpSecret) {
    // 2FA включена: не выдаём сессию, уходим на второй шаг. Факт 2FA виден лишь
    // ПОСЛЕ верного пароля — т.е. самому владельцу первого фактора, не оракулу.
    const challenge = await issueTotpChallenge(result.session.operatorId);
    cookies().set(ADMIN_TOTP_CHALLENGE_COOKIE, challenge, cookieOptions(TOTP_CHALLENGE_TTL_SECONDS));
    return { step: 'totp' };
  }

  // 2FA не настроена: впускаем, но защищённая зона принудит к регистрации TOTP.
  return finishLogin(result.session);
}
