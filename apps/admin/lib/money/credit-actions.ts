'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { parseUsdtAmountToCents } from '@broker/money';
import { getOperatorSession } from '../auth/current';
import { LOGIN_PATH } from '../auth/constants';
import type { MoneyActionState } from '../crypto/actions';
import { terminalMoney } from '../crypto/runtime';
import {
  approveManualCredit,
  declineManualCredit,
  initiateManualCredit,
  retryManualCredit,
  type CreditActor,
  type ManualCreditResult,
} from './manual-credit';
import { isMoneyInitiatorRole } from './types';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

async function creditActor(): Promise<CreditActor | null> {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);
  if (!isMoneyInitiatorRole(operator.role)) return null;
  return { operatorId: operator.operatorId, role: operator.role, login: operator.login };
}

function toState(r: ManualCreditResult): MoneyActionState {
  if (r.ok) {
    return r.state === 'executed'
      ? { ok: true, message: r.replay ? 'Зачисление уже было проведено терминалом — повтор ничего не добавил.' : 'Зачислено на реальный счёт клиента.' }
      : { ok: true, message: 'Команда создана и ждёт второго подтверждения другим оператором (раздел «Деньги» → «Ручные зачисления»).' };
  }
  if (r.reason === 'terminalRefused') return { error: 'terminalRefused', detail: r.code };
  if (r.reason === 'terminalUnavailable') return { error: 'creditUnavailable' };
  return { error: r.reason };
}

function revalidate(userId?: string) {
  revalidatePath('/money');
  if (userId) revalidatePath(`/clients/${userId}`);
}

export async function manualCreditAction(_prev: MoneyActionState, fd: FormData): Promise<MoneyActionState> {
  const actor = await creditActor();
  if (!actor) return { error: 'forbidden' };
  const amount = parseUsdtAmountToCents(str(fd, 'amount'));
  if (!amount.ok) return { error: 'invalidAmount' };
  const userId = str(fd, 'userId');
  const r = await initiateManualCredit(
    { actor, userId, amountMinor: amount.cents, basis: str(fd, 'reason') },
    { terminal: terminalMoney() },
  );
  revalidate(userId);
  return toState(r);
}

export async function approveCreditAction(_prev: MoneyActionState, fd: FormData): Promise<MoneyActionState> {
  const actor = await creditActor();
  if (!actor) return { error: 'forbidden' };
  const r = await approveManualCredit(
    { actor, commandId: str(fd, 'commandId'), note: str(fd, 'reason') },
    { terminal: terminalMoney() },
  );
  revalidate(str(fd, 'userId') || undefined);
  return toState(r);
}

export async function retryCreditAction(_prev: MoneyActionState, fd: FormData): Promise<MoneyActionState> {
  const actor = await creditActor();
  if (!actor) return { error: 'forbidden' };
  const r = await retryManualCredit(
    { actor, commandId: str(fd, 'commandId'), note: str(fd, 'reason') },
    { terminal: terminalMoney() },
  );
  revalidate(str(fd, 'userId') || undefined);
  return toState(r);
}

export async function declineCreditAction(_prev: MoneyActionState, fd: FormData): Promise<MoneyActionState> {
  const actor = await creditActor();
  if (!actor) return { error: 'forbidden' };
  const r = await declineManualCredit({ actor, commandId: str(fd, 'commandId'), reason: str(fd, 'reason') });
  revalidate(str(fd, 'userId') || undefined);
  return r.ok ? { ok: true, message: 'Команда отклонена, деньги не двигались.' } : { error: r.reason };
}
