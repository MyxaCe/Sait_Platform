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

export interface LoginState {
  error?: string;
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

  if (isRateLimited(`admin-login:${clientIp()}`, 10, 60_000)) {
    return inTotpStep ? { error: 'rateLimited', step: 'totp' } : { error: 'rateLimited' };
  }

  if (inTotpStep) {
    const operatorId = await verifyTotpChallenge(cookies().get(ADMIN_TOTP_CHALLENGE_COOKIE)?.value);
    if (!operatorId) {
      cookies().delete(ADMIN_TOTP_CHALLENGE_COOKIE);
      return { error: 'invalidCredentials' };
    }
    const code = String(formData.get('code') ?? '');
    const result = await verifyOperatorTotpStep(operatorId, code);
    if (!result.ok) {
      return { error: 'invalidCredentials', step: 'totp' };
    }
    cookies().delete(ADMIN_TOTP_CHALLENGE_COOKIE);
    return finishLogin(result.session);
  }

  cookies().delete(ADMIN_TOTP_CHALLENGE_COOKIE);

  const login = String(formData.get('login') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!login || !password) {
    return { error: 'invalidCredentials' };
  }

  const result = await verifyOperatorCredentials(login, password);
  if (!result.ok) {
    return { error: 'invalidCredentials' };
  }

  if (result.totpSecret) {
    const challenge = await issueTotpChallenge(result.session.operatorId);
    cookies().set(ADMIN_TOTP_CHALLENGE_COOKIE, challenge, cookieOptions(TOTP_CHALLENGE_TTL_SECONDS));
    return { step: 'totp' };
  }

  return finishLogin(result.session);
}
