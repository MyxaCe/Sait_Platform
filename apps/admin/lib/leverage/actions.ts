'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getOperatorSession } from '../auth/current';
import { LOGIN_PATH } from '../auth/constants';
import { changePortfolioLeverage, setClassOverride } from './portfolio';
import { setClientPortfolio, setClientOverride, clearClientOverride } from './client';

/**
 * Серверные экшены зоны «Риск/плечо» (WEB-45/46/47, Р-446, Р-049, Р-451).
 *
 * **server actions, не `/api`.** Та же причина, что у KYC и клиентов: `/api`
 * закрыт по умолчанию (Р-451 п.3); action — POST в уже защищённый
 * `(protected)`-роут, новой публичной поверхности не заводит.
 *
 * **Автор — из сессии, НЕ из формы (Р-451).** `operatorId` из
 * `getOperatorSession()`. Нет сессии → на вход (defense in depth).
 *
 * **Роль-гейт fail-closed (§3.8/§3.9, Р-446): admin ПИШЕТ, operator — ТОЛЬКО
 * просмотр.** operator (и любой без роли admin) получает `forbidden` до
 * транзакции. В UI форм у него нет (не отрисованы) — это второй рубеж на сервере.
 */

export interface LeverageActionState {
  error?: string;
  ok?: boolean;
}

/**
 * Исход ядра → состояние формы. Отказ терминала по существу несёт код
 * (`terminalRefused`); в форме — общий текст, код — в логе сервера.
 */
function toState(result: { ok: true } | { ok: false; reason: string; code?: string }): LeverageActionState {
  if (result.ok) return { ok: true };
  if (result.reason === 'terminalRefused') {
    console.error(`[leverage] терминал отказал в смене плеча: ${result.code ?? 'без кода'}`);
  }
  return { error: result.reason };
}

async function requireAdmin() {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);
  if (operator.role !== 'admin') return null;
  return operator;
}

function intField(formData: FormData, name: string): number | null {
  const raw = String(formData.get(name) ?? '').trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

/** §3.9 · сменить базовое плечо портфеля глобально (WEB-47). */
export async function changePortfolioLeverageAction(
  _prev: LeverageActionState,
  formData: FormData,
): Promise<LeverageActionState> {
  const operator = await requireAdmin();
  if (!operator) return { error: 'forbidden' };

  const portfolioKey = String(formData.get('portfolioKey') ?? '').trim();
  if (!portfolioKey) return { error: 'noPortfolio' };
  const baseLeverage = intField(formData, 'baseLeverage');
  if (baseLeverage === null || Number.isNaN(baseLeverage)) return { error: 'invalidLeverage' };
  const reason = String(formData.get('reason') ?? '');

  const result = await changePortfolioLeverage({
    operatorId: operator.operatorId,
    operatorLogin: operator.login,
    portfolioKey,
    baseLeverage,
    reason,
  });
  if (!result.ok) return toState(result);

  revalidatePath('/risk/portfolios');
  return { ok: true };
}

/** §3.9 · задать/снять планку класса внутри портфеля (WEB-45). */
export async function setClassOverrideAction(
  _prev: LeverageActionState,
  formData: FormData,
): Promise<LeverageActionState> {
  const operator = await requireAdmin();
  if (!operator) return { error: 'forbidden' };

  const portfolioKey = String(formData.get('portfolioKey') ?? '').trim();
  if (!portfolioKey) return { error: 'noPortfolio' };
  const instrumentClass = String(formData.get('instrumentClass') ?? '').trim();
  const reason = String(formData.get('reason') ?? '');
  // Пустое поле плеча = снять планку (null); иначе — число.
  const raw = intField(formData, 'leverage');
  if (raw !== null && Number.isNaN(raw)) return { error: 'invalidLeverage' };

  const result = await setClassOverride({
    operatorId: operator.operatorId,
    operatorLogin: operator.login,
    portfolioKey,
    instrumentClass,
    leverage: raw,
    reason,
  });
  if (!result.ok) return toState(result);

  revalidatePath('/risk/portfolios');
  return { ok: true };
}

/** §3.8 · назначить клиенту портфель (WEB-44, атрибут клиента). */
export async function setClientPortfolioAction(
  _prev: LeverageActionState,
  formData: FormData,
): Promise<LeverageActionState> {
  const operator = await requireAdmin();
  if (!operator) return { error: 'forbidden' };

  const userId = String(formData.get('userId') ?? '').trim();
  if (!userId) return { error: 'invalidClient' };
  const portfolioKey = String(formData.get('portfolioKey') ?? '').trim();
  if (!portfolioKey) return { error: 'noPortfolio' };
  const reason = String(formData.get('reason') ?? '');

  const result = await setClientPortfolio({
    operatorId: operator.operatorId,
    operatorLogin: operator.login,
    userId,
    portfolioKey,
    reason,
  });
  if (!result.ok) return toState(result);

  revalidatePath('/risk/leverage');
  return { ok: true };
}

/** §3.8 · выдать клиенту override по заявке (WEB-46, journaled). */
export async function setClientOverrideAction(
  _prev: LeverageActionState,
  formData: FormData,
): Promise<LeverageActionState> {
  const operator = await requireAdmin();
  if (!operator) return { error: 'forbidden' };

  const userId = String(formData.get('userId') ?? '').trim();
  if (!userId) return { error: 'invalidClient' };
  const leverage = intField(formData, 'leverage');
  if (leverage === null || Number.isNaN(leverage)) return { error: 'invalidLeverage' };
  const reason = String(formData.get('reason') ?? '');
  const ticket = String(formData.get('ticket') ?? '');

  const result = await setClientOverride({
    operatorId: operator.operatorId,
    operatorLogin: operator.login,
    userId,
    leverage,
    reason,
    ticket,
  });
  if (!result.ok) return toState(result);

  revalidatePath('/risk/leverage');
  return { ok: true };
}

/** §3.8 · снять override клиента — вернуть к портфелю (WEB-46, journaled). */
export async function clearClientOverrideAction(
  _prev: LeverageActionState,
  formData: FormData,
): Promise<LeverageActionState> {
  const operator = await requireAdmin();
  if (!operator) return { error: 'forbidden' };

  const userId = String(formData.get('userId') ?? '').trim();
  if (!userId) return { error: 'invalidClient' };
  const reason = String(formData.get('reason') ?? '');

  const result = await clearClientOverride({
    operatorId: operator.operatorId,
    operatorLogin: operator.login,
    userId,
    reason,
  });
  if (!result.ok) return toState(result);

  revalidatePath('/risk/leverage');
  return { ok: true };
}
