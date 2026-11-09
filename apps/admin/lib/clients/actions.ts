'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getOperatorSession } from '../auth/current';
import { LOGIN_PATH } from '../auth/constants';
import { revokeClientSessions, setClientBlock, type BlockAction } from './block';

/**
 * Серверные экшены зоны «Клиенты» (ADM-02, Р-049, Р-394).
 *
 * **Почему server actions, а не `/api`.** Та же причина, что у KYC
 * (`lib/kyc/actions.ts`): `/api` закрыт по умолчанию (Р-451 п.3), server action
 * — POST в уже защищённый `(protected)`-роут, новой публичной поверхности не
 * заводит.
 *
 * **Автор — из сессии, НЕ из формы (Р-451).** `operatorId` берём из
 * `getOperatorSession()`. Нет сессии → на вход (defense in depth поверх
 * middleware).
 *
 * **Роль-гейт: блокировка — только admin (дизайн §3.2, консервативно).**
 * fail-closed: operator (и кто угодно без роли admin) получает `forbidden`, до
 * транзакции дело не доходит. В UI кнопок у него и так нет (не отрисованы), это
 * второй рубеж на сервере.
 */

export interface ClientActionState {
  error?: string;
  ok?: boolean;
}

async function requireAdmin() {
  const operator = await getOperatorSession();
  if (!operator) {
    // Личность автора решения обязана быть из валидной сессии — иначе на вход.
    redirect(LOGIN_PATH);
  }
  if (operator.role !== 'admin') {
    // Блокировка — admin-действие; operator сюда не допускается (fail-closed).
    return null;
  }
  return operator;
}

async function changeBlock(
  action: BlockAction,
  formData: FormData,
): Promise<ClientActionState> {
  const operator = await requireAdmin();
  if (!operator) return { error: 'forbidden' };

  const userId = String(formData.get('userId') ?? '').trim();
  if (!userId) return { error: 'invalidClient' };
  const reason = String(formData.get('reason') ?? '');

  const result = await setClientBlock({
    operatorId: operator.operatorId,
    userId,
    action,
    reason,
  });

  if (!result.ok) return { error: result.reason };

  // Карточка серверная (force-dynamic), но ревалидируем явно — состояние и
  // журнальная лента изменились, покажем их сразу после действия.
  revalidatePath(`/clients/${userId}`);
  revalidatePath('/clients');
  return { ok: true };
}

export async function blockClientAction(
  _prev: ClientActionState,
  formData: FormData,
): Promise<ClientActionState> {
  return changeBlock('block', formData);
}

export async function unblockClientAction(
  _prev: ClientActionState,
  formData: FormData,
): Promise<ClientActionState> {
  return changeBlock('unblock', formData);
}

/**
 * «Погасить сессии» клиента (ADM-02).
 *
 * Гашение НАСТОЯЩЕЕ: строки `sessions` клиента удаляются, и запись
 * `client.sessions_revoked` (кто/когда/основание/сколько) пишется ТОЙ ЖЕ
 * транзакцией (`revokeClientSessions`). Удалённая строка = немедленный выход из
 * кабинета; терминалу кабинет больше не выдаст SSO-токен, и терминал
 * разлогинится не позже своего TTL. Прямого командного пути в in-memory
 * сессии терминала по-прежнему нет (долг ADM-01) — поэтому «не позже TTL», а
 * не «мгновенно».
 */
export async function revokeClientSessionsAction(
  _prev: ClientActionState,
  formData: FormData,
): Promise<ClientActionState> {
  const operator = await requireAdmin();
  if (!operator) return { error: 'forbidden' };

  const userId = String(formData.get('userId') ?? '').trim();
  if (!userId) return { error: 'invalidClient' };
  const reason = String(formData.get('reason') ?? '');

  let result;
  try {
    result = await revokeClientSessions({ operatorId: operator.operatorId, userId, reason });
  } catch {
    // Транзакция откатилась: ни гашения, ни записи (fail-closed).
    return { error: 'journalUnavailable' };
  }
  if (!result.ok) return { error: result.reason };

  revalidatePath(`/clients/${userId}`);
  return { ok: true };
}
