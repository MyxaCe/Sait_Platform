'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  approveWithdrawal,
  bindUnidentifiedDeposit,
  markWithdrawalSent,
  parseUsdtAmountToCents,
  rejectWithdrawal,
  settleWithdrawalManually,
  type KycSetting,
} from '@broker/money';
import { getOperatorSession } from '../auth/current';
import { LOGIN_PATH } from '../auth/constants';
import { canOperateMoney, moneyPool, terminalMoney } from './runtime';
import { setClientMoneyFlags } from './flags';
import { updatePlatformMoneySettings } from './settings';
import { percentToBps, setClientUnverifiedWithdrawLimit } from './withdraw-limit';
import { updateMinStop } from '../terminal-settings/stops';
import { findClientForBinding } from './queries';

/**
 * Серверные экшены денежной зоны. Автор — из сессии (Р-451), роль-гейт
 * fail-closed на сервере: деньги — admin и finance_operator (без второго
 * аппрува, решение штаба 09.11); настройки платформы — только admin.
 */

export interface MoneyActionState {
  error?: string;
  detail?: string;
  ok?: boolean;
}

async function requireMoneyOperator() {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);
  return canOperateMoney(operator.role) ? operator : null;
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

function fromResult(r: { ok: true } | { ok: false; reason: string; code?: string }): MoneyActionState {
  if (r.ok) return { ok: true };
  return { error: r.reason, ...(r.code ? { detail: r.code } : {}) };
}

/* ── Настройки платформы (admin) ───────────────────────────────────── */

function minorFromField(fd: FormData, k: string): number | null {
  const p = parseUsdtAmountToCents(str(fd, k));
  if (p.ok) return p.cents;
  // Ноль — законный минимум («без минимума»), а парсер суммы его отвергает.
  return /^0+(?:[.,]0{0,2})?$/.test(str(fd, k)) ? 0 : null;
}

export async function updatePlatformSettingsAction(
  _prev: MoneyActionState,
  fd: FormData,
): Promise<MoneyActionState> {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);
  if (operator.role !== 'admin') return { error: 'forbidden' };

  const minDeposit = minorFromField(fd, 'minDeposit');
  const minWithdraw = minorFromField(fd, 'minWithdraw');
  if (minDeposit === null || minWithdraw === null) return { error: 'invalidMinimum' };
  const unverifiedWithdrawBps = percentToBps(str(fd, 'unverifiedWithdrawPct'));
  if (unverifiedWithdrawBps === null) return { error: 'invalidPercent' };

  const r = await updatePlatformMoneySettings({
    operatorId: operator.operatorId,
    reason: str(fd, 'reason'),
    next: {
      depositRequiresKyc: fd.get('depositRequiresKyc') === 'on',
      withdrawRequiresKyc: fd.get('withdrawRequiresKyc') === 'on',
      minDepositMinor: minDeposit,
      minWithdrawMinor: minWithdraw,
      unverifiedWithdrawBps,
    },
  });
  revalidatePath('/settings');
  return fromResult(r);
}

/* ── Минимальное расстояние SL/TP в терминале (admin, как настройки платформы) ── */

export async function updateMinStopAction(_prev: MoneyActionState, fd: FormData): Promise<MoneyActionState> {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);
  if (operator.role !== 'admin') return { error: 'forbidden' };

  const raw = str(fd, 'minStopBps');
  const minStopBps = /^\d{1,5}$/.test(raw) ? Number(raw) : NaN;
  const r = await updateMinStop({ operatorId: operator.operatorId, reason: str(fd, 'reason'), minStopBps });
  revalidatePath('/settings');
  return fromResult(r);
}

/* ── Флаги клиента (admin, finance_operator) ───────────────────────── */

function asKyc(v: string): KycSetting {
  return v === 'required' || v === 'not_required' ? v : 'inherit';
}

export async function setClientMoneyFlagsAction(
  _prev: MoneyActionState,
  fd: FormData,
): Promise<MoneyActionState> {
  const operator = await requireMoneyOperator();
  if (!operator) return { error: 'forbidden' };
  const userId = str(fd, 'userId');
  if (!userId) return { error: 'noClient' };

  const r = await setClientMoneyFlags({
    operatorId: operator.operatorId,
    operatorLogin: operator.login,
    userId,
    reason: str(fd, 'reason'),
    next: {
      depositKyc: asKyc(str(fd, 'depositKyc')),
      withdrawKyc: asKyc(str(fd, 'withdrawKyc')),
      frozen: fd.get('frozen') === 'on',
      withdrawBanned: fd.get('withdrawBanned') === 'on',
    },
  });
  revalidatePath(`/clients/${userId}`);
  return fromResult(r);
}

/* ── Лимит вывода без верификации у клиента (admin, finance_operator) ── */

export async function setClientWithdrawLimitAction(
  _prev: MoneyActionState,
  fd: FormData,
): Promise<MoneyActionState> {
  const operator = await requireMoneyOperator();
  if (!operator) return { error: 'forbidden' };
  const userId = str(fd, 'userId');
  if (!userId) return { error: 'noClient' };

  // «Наследовать» — пустое переопределение; иначе процент из поля.
  let bps: number | null = null;
  if (str(fd, 'mode') !== 'inherit') {
    bps = percentToBps(str(fd, 'pct'));
    if (bps === null) return { error: 'invalidPercent' };
  }
  const r = await setClientUnverifiedWithdrawLimit({
    operatorId: operator.operatorId,
    userId,
    reason: str(fd, 'reason'),
    bps,
  });
  revalidatePath(`/clients/${userId}`);
  return fromResult(r);
}

/* ── Неопознанные поступления ──────────────────────────────────────── */

export async function bindUnidentifiedAction(
  _prev: MoneyActionState,
  fd: FormData,
): Promise<MoneyActionState> {
  const operator = await requireMoneyOperator();
  if (!operator) return { error: 'forbidden' };
  const userId = await findClientForBinding(str(fd, 'client'));
  if (!userId) return { error: 'clientNotFound' };

  const r = await bindUnidentifiedDeposit(moneyPool(), terminalMoney(), {
    depositId: str(fd, 'depositId'),
    userId,
    operatorId: operator.operatorId,
    operatorLogin: operator.login,
    reason: str(fd, 'reason'),
  });
  revalidatePath('/money');
  return fromResult(r);
}

/* ── Выводы ────────────────────────────────────────────────────────── */

function opInput(fd: FormData, operator: { operatorId: string; login: string }) {
  return {
    withdrawalId: str(fd, 'withdrawalId'),
    operatorId: operator.operatorId,
    operatorLogin: operator.login,
    reason: str(fd, 'reason'),
  };
}

export async function withdrawalDecisionAction(
  _prev: MoneyActionState,
  fd: FormData,
): Promise<MoneyActionState> {
  const operator = await requireMoneyOperator();
  if (!operator) return { error: 'forbidden' };
  const input = opInput(fd, operator);
  const decision = str(fd, 'decision');

  let r;
  switch (decision) {
    case 'approve':
      r = await approveWithdrawal(moneyPool(), terminalMoney(), input);
      break;
    case 'reject':
      r = await rejectWithdrawal(moneyPool(), terminalMoney(), input);
      break;
    case 'sent':
      r = await markWithdrawalSent(moneyPool(), { ...input, txHash: str(fd, 'txHash') });
      break;
    case 'settle':
      r = await settleWithdrawalManually(moneyPool(), input);
      break;
    default:
      return { error: 'invalidDecision' };
  }
  revalidatePath('/money');
  return fromResult(r);
}
