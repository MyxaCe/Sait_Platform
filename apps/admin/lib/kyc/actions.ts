'use server';

import { redirect } from 'next/navigation';
import { getOperatorSession } from '../auth/current';
import { LOGIN_PATH } from '../auth/constants';
import { decideClientVerification, type VerificationDecision } from './decide';

/**
 * Серверные экшены решения по KYC (ADM-08, Р-451 п.4).
 *
 * **Почему server actions, а не `/api`-ручки.** `/api` закрыт по умолчанию
 * (Р-451 п.3); каждая новая ручка — новая поверхность под отдельную охрану.
 * Страницы `(protected)` уже за гейтом (middleware + layout), а server action
 * — POST в тот же защищённый роут. Никакой новой публичной `/api`-поверхности
 * KYC не заводит; тот же выбор, что у входа (`loginAction`).
 *
 * **Автор решения — из сессии, не из формы (Р-451).** operatorId берётся из
 * `getOperatorSession()` на сервере. Форма НЕ передаёт личность оператора:
 * иначе журнал можно было бы подписать чужим именем. Нет сессии → на вход
 * (defense in depth: не доверяем, что middleware уже отфильтровал).
 *
 * Контракт с формой: `{ error }` при отказе; успех — redirect на `/kyc`.
 */

export interface DecisionState {
  error?: string;
}

async function decide(
  decision: VerificationDecision,
  formData: FormData,
): Promise<DecisionState> {
  const operator = await getOperatorSession();
  if (!operator) {
    // Личность автора решения обязана быть из валидной сессии — иначе отказ.
    redirect(LOGIN_PATH);
  }

  const userId = String(formData.get('userId') ?? '').trim();
  if (!userId) {
    return { error: 'invalidClient' };
  }
  const reason = String(formData.get('reason') ?? '');

  const result = await decideClientVerification({
    operatorId: operator.operatorId,
    userId,
    decision,
    reason,
  });

  if (!result.ok) {
    // Причины машиночитаемы; форма покажет человеку их смысл.
    return { error: result.reason };
  }

  // Клиент решён — он больше не в очереди; возвращаемся к списку pending.
  redirect('/kyc');
}

export async function verifyClientAction(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  return decide('verified', formData);
}

export async function rejectClientAction(
  _prev: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  return decide('rejected', formData);
}
