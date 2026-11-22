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

export interface EnrollStartResult {
  secret: string;
  uri: string;
}

export interface EnrollConfirmState {
  error?: string;
}

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

export async function confirmTotpEnrollment(
  _prev: EnrollConfirmState,
  formData: FormData,
): Promise<EnrollConfirmState> {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);

  const ticket = await verifyEnrollTicket(cookies().get(ADMIN_TOTP_ENROLL_COOKIE)?.value);
  if (!ticket || ticket.operatorId !== operator.operatorId) {
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
