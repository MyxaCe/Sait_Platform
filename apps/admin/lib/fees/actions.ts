'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getOperatorSession } from '../auth/current';
import { LOGIN_PATH } from '../auth/constants';
import { changePortfolioFees } from './portfolio-fees';

/**
 * Тариф портфеля (наценка/комиссия, условия типа счёта) — только admin
 * (как плечо портфеля, §3.9). Автор — из сессии (Р-451).
 */
export interface FeesActionState {
  ok?: boolean;
  error?: string;
}

function bps(fd: FormData, k: string): number {
  const raw = String(fd.get(k) ?? '').trim();
  if (raw === '') return Number.NaN;
  const n = Number(raw);
  return Number.isInteger(n) ? n : Number.NaN;
}

export async function changePortfolioFeesAction(_prev: FeesActionState, fd: FormData): Promise<FeesActionState> {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);
  if (operator.role !== 'admin') return { error: 'forbidden' };
  const portfolioKey = String(fd.get('portfolioKey') ?? '').trim();
  if (!portfolioKey) return { error: 'noPortfolio' };
  const r = await changePortfolioFees({
    operatorId: operator.operatorId,
    operatorLogin: operator.login,
    portfolioKey,
    markupBps: bps(fd, 'markupBps'),
    commissionBps: bps(fd, 'commissionBps'),
    instruments: String(fd.get('instruments') ?? ''),
    description: String(fd.get('description') ?? ''),
    reason: String(fd.get('reason') ?? ''),
  });
  if (!r.ok) return { error: r.reason };
  revalidatePath('/risk/portfolios');
  return { ok: true };
}
