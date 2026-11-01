'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getOperatorSession } from '../auth/current';
import { LOGIN_PATH } from '../auth/constants';
import { appendJournalEntry } from '../journal/journal';
import { setClientBlock, type BlockAction } from './block';

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
 * «Погасить сессии» клиента (ADM-02, долг ADM-01).
 *
 * ВАЖНО — ЧЕСТНО: фактического гашения здесь НЕТ. Боевые сессии клиента живут
 * в in-memory сессиях ТЕРМИНАЛА, до которого у операторского периметра нет
 * командного пути (разведка ADM-01: входящей командной поверхности у терминала
 * нет). Поэтому экшен журналирует НАМЕРЕНИЕ `client.sessions_revoked` (кто/
 * когда/основание) — чтобы след был и аудит видел запрос, — но ничего не гасит.
 * Реальное гашение — отдельная задача на стороне терминала.
 *
 * Клиентские cookie-сессии кабинета (таблица `sessions`) мы здесь тоже НЕ
 * трогаем сознательно: их жизненный цикл — зона кабинета, а не операторского
 * периметра; смешивать гашение терминала и ревокацию кабинетных кук в одной
 * кнопке «погасить сессии» значило бы выдать половину за целое.
 */
export async function revokeClientSessionsAction(
  _prev: ClientActionState,
  formData: FormData,
): Promise<ClientActionState> {
  const operator = await requireAdmin();
  if (!operator) return { error: 'forbidden' };

  const userId = String(formData.get('userId') ?? '').trim();
  if (!userId) return { error: 'invalidClient' };
  const reason = String(formData.get('reason') ?? '').trim();
  if (reason.length === 0) return { error: 'missingReason' };

  try {
    await appendJournalEntry({
      operatorId: operator.operatorId,
      action: 'client.sessions_revoked',
      subjectKind: 'client',
      subjectId: userId,
      // intent: true — запись честно помечена намерением, не фактом гашения.
      payload: { basis: reason, intent: true, note: 'terminal-side revocation pending (ADM-01 debt)' },
    });
  } catch {
    // Журнал не принял запись — намерение без следа не фиксируем (fail-closed).
    return { error: 'journalUnavailable' };
  }

  revalidatePath(`/clients/${userId}`);
  return { ok: true };
}
