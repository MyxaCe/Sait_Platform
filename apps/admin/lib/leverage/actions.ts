'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getOperatorSession } from '../auth/current';
import { LOGIN_PATH } from '../auth/constants';
import { LEVERAGE_CLASSES } from '@broker/money';
import { changePortfolioLeverage, setClassLeverageTable } from './portfolio';
import { setClientPortfolio, setClientOverride, clearClientOverride } from './client';

export interface LeverageActionState {
  error?: string;
  ok?: boolean;
}

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

export async function setClassLeverageTableAction(
  _prev: LeverageActionState,
  formData: FormData,
): Promise<LeverageActionState> {
  const operator = await requireAdmin();
  if (!operator) return { error: 'forbidden' };

  const portfolioKey = String(formData.get('portfolioKey') ?? '').trim();
  if (!portfolioKey) return { error: 'noPortfolio' };
  const reason = String(formData.get('reason') ?? '');
  const table: Record<string, number | null> = {};
  for (const cls of LEVERAGE_CLASSES) {
    const raw = intField(formData, `class.${cls}`);
    if (raw !== null && Number.isNaN(raw)) return { error: 'invalidLeverage' };
    table[cls] = raw;
  }

  const result = await setClassLeverageTable({
    operatorId: operator.operatorId,
    operatorLogin: operator.login,
    portfolioKey,
    table,
    reason,
  });
  if (!result.ok) return toState(result);

  revalidatePath('/risk/portfolios');
  return { ok: true };
}

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
