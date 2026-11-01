'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_TOTP_ENROLL_COOKIE, LOGIN_PATH } from '../auth/constants';
import { getOperatorSession } from '../auth/current';
import { isOperatorEnrolled, saveOperatorTotpSecret } from '../auth/operator-totp';
import {
  buildOtpauthUri,
  generateTotpSecret,
  TOTP_DEFAULTS,
  verifyTotp,
} from '../auth/totp';
import {
  issueEnrollTicket,
  TOTP_ENROLL_TTL_SECONDS,
  verifyEnrollTicket,
} from '../auth/totp-challenge';

/**
 * Server actions регистрации второго фактора (ADM-13, Р-454 III-3).
 *
 * Как и у входа и KYC — server actions, а не `/api` (default-deny на `/api`
 * сохраняется, новой публичной поверхности нет). Личность — ВСЕГДА из
 * серверной сессии, не из формы (Р-451).
 *
 * **Почему секрет живёт в тикете, а не в базе до подтверждения.** В
 * `operators.totp_secret` секрет пишется ТОЛЬКО после того, как оператор
 * доказал владение им верным кодом. До этого непроверенный секрет лежит в
 * подписанном httpOnly-тикете (ENROLL). Так инвариант «секрет в базе = 2FA
 * включена» не ломается, и вход не начинает требовать код по секрету, который
 * оператор ещё не завёл в приложение (иначе — самоблокировка).
 */

export interface EnrollStartResult {
  secret: string;
  uri: string;
}

export interface EnrollConfirmState {
  error?: string;
}

/**
 * Начало регистрации: генерируем секрет, кладём его в ENROLL-тикет (кука),
 * отдаём provisioning-URI и ручной ключ для сканирования. Повторный вызов
 * выдаёт НОВЫЙ секрет — пока не подтверждён, это безопасно (в базу не попал).
 * Уже включённую 2FA не трогаем: смена фактора — отдельный привилегированный
 * поток, не эта форма.
 */
export async function beginTotpEnrollment(): Promise<EnrollStartResult | { error: string }> {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);
  if (await isOperatorEnrolled(operator.operatorId)) {
    return { error: 'alreadyEnrolled' };
  }

  const secret = generateTotpSecret();
  const ticket = await issueEnrollTicket(operator.operatorId, secret);
  cookies().set(ADMIN_TOTP_ENROLL_COOKIE, ticket, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TOTP_ENROLL_TTL_SECONDS,
  });

  const uri = buildOtpauthUri({ secret, accountName: operator.login });
  return { secret, uri };
}

/**
 * Подтверждение: сверяем код с секретом из ENROLL-тикета (окно ±1, Р-454). При
 * верном коде секрет сохраняется и журналируется `operator.totp_enrolled`
 * одной транзакцией; тикет гасится; redirect внутрь. Неверный/просроченный —
 * общий отказ, секрет не раскрываем (fail-closed).
 */
export async function confirmTotpEnrollment(
  _prev: EnrollConfirmState,
  formData: FormData,
): Promise<EnrollConfirmState> {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);

  const ticket = await verifyEnrollTicket(cookies().get(ADMIN_TOTP_ENROLL_COOKIE)?.value);
  if (!ticket || ticket.operatorId !== operator.operatorId) {
    // Тикет истёк/чужой — просим начать заново (fail-closed).
    cookies().delete(ADMIN_TOTP_ENROLL_COOKIE);
    return { error: 'expired' };
  }

  const code = String(formData.get('code') ?? '');
  if (!verifyTotp(ticket.secret, code, { window: TOTP_DEFAULTS.window })) {
    return { error: 'invalidCode' };
  }

  await saveOperatorTotpSecret(operator.operatorId, operator.login, ticket.secret);
  cookies().delete(ADMIN_TOTP_ENROLL_COOKIE);
  redirect('/');
}
