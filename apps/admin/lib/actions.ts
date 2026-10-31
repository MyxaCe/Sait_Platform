'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_SESSION_COOKIE } from './auth/constants';
import { verifyOperatorCredentials } from './auth/login';
import { issueOperatorSessionToken, SESSION_TTL_SECONDS } from './auth/session';
import { appendJournalEntry } from './journal/journal';
import { isRateLimited } from './rate-limit';

/**
 * Серверный экшен входа оператора (ADM-01, Р-451).
 *
 * **Почему server action на публичной `/login`, а не ручка `/api/login`.**
 * `/login` уже публичная страница, а server action — это POST в её же роут:
 * никакой НОВОЙ публичной поверхности `/api` не заводится. Р-451 требует
 * default-deny на всём `/api` с явным allowlist; чем короче allowlist, тем
 * меньше того, что надо отдельно охранять. Вход через server action оставляет
 * в allowlist только `/api/health`. CSRF у server actions закрывает Next
 * (проверка Origin/Host). Тот же выбор, что в кабинете.
 *
 * Контракт с формой: `{ error }` — общая ошибка ('rateLimited' |
 * 'invalidCredentials'). Успех — redirect на `/` (throw), не возврат.
 */

export interface LoginState {
  error?: string;
}

function clientIp(): string {
  return headers().get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  // Брутфорс по IP тормозим до обращения к базе и до argon2 (дорогой хеш —
  // не оружие против нас самих).
  if (isRateLimited(`admin-login:${clientIp()}`, 10, 60_000)) {
    return { error: 'rateLimited' };
  }

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

  const { session } = result;

  // Запись входа в неизменяемый журнал ДО выпуска сессии: «кто вошёл» —
  // операторское действие, и оно фиксируется (Р-049). Сбой журнала не должен
  // тихо впустить без следа — тогда отказываем во входе.
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
  cookies().set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });

  redirect('/');
}
