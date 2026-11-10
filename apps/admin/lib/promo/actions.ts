'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { appendJournalSeqWithinTx, inTransaction } from '@broker/money';
import {
  accrueCashback,
  accrueIbRevshare,
  approveReward,
  createIbPartner,
  createPromotion,
  finalizeContest,
  isPromotionType,
  PROMO_ACTIONS,
  reassignReferral,
  rejectReward,
  retryRewardCredit,
  setPromotionStatus,
  syncIbCpa,
  syncPromotionQueue,
  updateIbPartner,
  updatePromoSettings,
  updatePromotion,
  type CreditOutcome,
} from '@broker/promo';
import { getOperatorSession } from '../auth/current';
import { LOGIN_PATH } from '../auth/constants';
import { moneyPool, terminalMoney } from '../crypto/runtime';
import { countriesField, intField, percentField, promotionFromForm, usdtField } from './form';
import { canManagePromo, canViewPromo } from './runtime';

/**
 * Серверные экшены зоны «Акции и партнёры». Автор — из сессии (Р-451), роль —
 * fail-closed на сервере (формы у чужой роли и так не отрисованы — это второй
 * рубеж): очередь начислений — admin и finance_operator; всё остальное — admin.
 */

export interface PromoActionState {
  ok?: boolean;
  error?: string;
  detail?: string;
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

async function operatorWith(check: (role: Parameters<typeof canViewPromo>[0]) => boolean) {
  const operator = await getOperatorSession();
  if (!operator) redirect(LOGIN_PATH);
  return check(operator.role) ? operator : null;
}

function fail(r: { reason: string; issues?: string[]; code?: string }): PromoActionState {
  const detail = r.issues?.length ? r.issues.slice(0, 3).join('; ') : r.code;
  return { error: r.reason, ...(detail ? { detail } : {}) };
}

/* ── Акции ────────────────────────────────────────────────────────────── */

export async function savePromotionAction(_prev: PromoActionState, fd: FormData): Promise<PromoActionState> {
  const op = await operatorWith(canManagePromo);
  if (!op) return { error: 'forbidden' };
  const id = str(fd, 'id');
  const type = str(fd, 'type');
  if (!isPromotionType(type)) return { error: 'wrongType' };
  const promotion = promotionFromForm(fd, type);
  const reason = str(fd, 'reason');
  const r = id
    ? await updatePromotion(moneyPool(), { operatorId: op.operatorId, reason, id, promotion })
    : await createPromotion(moneyPool(), { operatorId: op.operatorId, reason, promotion });
  if (!r.ok) return fail(r);
  revalidatePath('/promo');
  if (!id) redirect(`/promo/${r.id}`);
  revalidatePath(`/promo/${r.id}`);
  return { ok: true };
}

export async function setPromotionStatusAction(_prev: PromoActionState, fd: FormData): Promise<PromoActionState> {
  const op = await operatorWith(canManagePromo);
  if (!op) return { error: 'forbidden' };
  const to = str(fd, 'to');
  if (to !== 'active' && to !== 'paused' && to !== 'ended') return { error: 'wrongTransition' };
  const r = await setPromotionStatus(moneyPool(), { operatorId: op.operatorId, reason: str(fd, 'reason'), id: str(fd, 'id'), to });
  if (!r.ok) return fail(r);
  revalidatePath('/promo');
  revalidatePath(`/promo/${str(fd, 'id')}`);
  return { ok: true };
}

/**
 * «Пересчитать очередь»: движок оценивает участников и ставит выполнивших
 * условия в очередь (денег не двигает). Запуск журналируется от оператора,
 * сами постановки — от системного автора движка.
 */
export async function syncQueueAction(_prev: PromoActionState, fd: FormData): Promise<PromoActionState> {
  const op = await operatorWith(canViewPromo);
  if (!op) return { error: 'forbidden' };
  const reason = str(fd, 'reason');
  if (!reason) return { error: 'missingReason' };
  const id = str(fd, 'id');
  const pool = moneyPool();
  const report = id ? await syncPromotionQueue(pool, id) : { evaluated: 0, queued: 0, expired: 0 };
  const ib = await syncIbCpa(pool);
  if (report.skipped === 'platform_disabled') return { error: 'platformDisabled' };
  await inTransaction(pool, async (tx) => {
    await appendJournalSeqWithinTx(
      {
        operatorId: op.operatorId,
        action: PROMO_ACTIONS.synced,
        subjectKind: id ? 'promotion' : 'platform',
        subjectId: id || 'promo_queue',
        payload: {
          basis: reason,
          evaluated: report.evaluated,
          queued: report.queued + ib.queued,
          expired: report.expired,
          skipped: report.skipped ?? null,
        },
      },
      tx,
    );
  });
  revalidatePath('/promo', 'layout');
  return { ok: true, detail: `оценено ${report.evaluated + ib.evaluated}, в очередь ${report.queued + ib.queued}, истекло ${report.expired + ib.expired}` };
}

export async function accrueCashbackAction(_prev: PromoActionState, fd: FormData): Promise<PromoActionState> {
  const op = await operatorWith(canManagePromo);
  if (!op) return { error: 'forbidden' };
  const r = await accrueCashback(moneyPool(), {
    promotionId: str(fd, 'id'),
    period: str(fd, 'period'),
    operatorId: op.operatorId,
    reason: str(fd, 'reason'),
  });
  if (!r.ok) return { error: r.reason === 'invalidPeriod' ? 'invalidPeriodValue' : r.reason };
  revalidatePath('/promo', 'layout');
  return { ok: true, detail: `в очередь ${r.queued}, без начисления ${r.zero}` };
}

/* ── Очередь начислений (admin + finance_operator) ────────────────────── */

function creditDetail(c: CreditOutcome): string | undefined {
  if (c.state === 'pending') return `терминал не ответил (${c.reason}) — исход неизвестен, повторите зачисление`;
  if (c.state === 'needs_review') return `терминал отказал: ${c.code}`;
  return undefined;
}

export async function rewardDecisionAction(_prev: PromoActionState, fd: FormData): Promise<PromoActionState> {
  const op = await operatorWith(canViewPromo);
  if (!op) return { error: 'forbidden' };
  const rewardId = str(fd, 'rewardId');
  const reason = str(fd, 'reason');
  const decision = str(fd, 'decision');
  const pool = moneyPool();
  let out: PromoActionState;
  if (decision === 'approve') {
    const r = await approveReward(pool, terminalMoney(), { rewardId, operatorId: op.operatorId, operatorLogin: op.login, reason });
    out = r.ok ? { ok: true, ...(creditDetail(r.credit) ? { detail: creditDetail(r.credit) } : {}) } : fail(r);
  } else if (decision === 'reject') {
    const r = await rejectReward(pool, { rewardId, operatorId: op.operatorId, reason });
    out = r.ok ? { ok: true } : fail(r);
  } else if (decision === 'retry') {
    const r = await retryRewardCredit(pool, terminalMoney(), { rewardId, operatorId: op.operatorId, operatorLogin: op.login, reason });
    out = r.ok ? { ok: true, ...(creditDetail(r.credit) ? { detail: creditDetail(r.credit) } : {}) } : fail(r);
  } else {
    out = { error: 'wrongTransition' };
  }
  revalidatePath('/promo', 'layout');
  return out;
}

/* ── Конкурс ──────────────────────────────────────────────────────────── */

export async function finalizeContestAction(_prev: PromoActionState, fd: FormData): Promise<PromoActionState> {
  const op = await operatorWith(canManagePromo);
  if (!op) return { error: 'forbidden' };
  const r = await finalizeContest(moneyPool(), { promotionId: str(fd, 'id'), operatorId: op.operatorId, reason: str(fd, 'reason') });
  if (!r.ok) return fail(r);
  revalidatePath('/promo', 'layout');
  return { ok: true, detail: `призов в очередь: ${r.queued}` };
}

/* ── Рефералы ─────────────────────────────────────────────────────────── */

export async function reassignReferralAction(_prev: PromoActionState, fd: FormData): Promise<PromoActionState> {
  const op = await operatorWith(canManagePromo);
  if (!op) return { error: 'forbidden' };
  const revoke = str(fd, 'mode') === 'revoke';
  const r = await reassignReferral(moneyPool(), {
    operatorId: op.operatorId,
    reason: str(fd, 'reason'),
    refereeUserId: str(fd, 'refereeUserId'),
    referrer: revoke ? null : str(fd, 'referrer'),
  });
  if (!r.ok) return fail(r);
  revalidatePath('/promo/referrals');
  return { ok: true };
}

/* ── IB-партнёры ──────────────────────────────────────────────────────── */

function partnerFromForm(fd: FormData) {
  const model = str(fd, 'model') === 'revshare' ? 'revshare' : 'cpa';
  return {
    displayName: str(fd, 'displayName'),
    model: model as 'cpa' | 'revshare',
    cpaAmountMinor: model === 'cpa' ? usdtField(fd, 'cpaAmount') : null,
    cpaRules:
      model === 'cpa'
        ? {
            kycRequired: fd.get('kycRequired') === 'on',
            minDepositMinor: usdtField(fd, 'minDeposit'),
            turnoverNotionalMinor: usdtField(fd, 'turnoverNotional'),
            minHoldSeconds: intField(fd, 'minHoldSeconds'),
            windowDays: intField(fd, 'windowDays'),
          }
        : {},
    revshareBps: model === 'revshare' ? percentField(fd, 'revsharePercent') : null,
    status: (str(fd, 'status') === 'paused' ? 'paused' : 'active') as 'active' | 'paused',
  };
}

export async function savePartnerAction(_prev: PromoActionState, fd: FormData): Promise<PromoActionState> {
  const op = await operatorWith(canManagePromo);
  if (!op) return { error: 'forbidden' };
  const id = str(fd, 'id');
  const partner = partnerFromForm(fd);
  const reason = str(fd, 'reason');
  const r = id
    ? await updateIbPartner(moneyPool(), { operatorId: op.operatorId, reason, id, partner })
    : await createIbPartner(moneyPool(), { operatorId: op.operatorId, reason, partner: { ...partner, client: str(fd, 'client') } });
  if (!r.ok) return fail(r);
  revalidatePath('/promo/partners');
  return { ok: true };
}

export async function accrueRevshareAction(_prev: PromoActionState, fd: FormData): Promise<PromoActionState> {
  const op = await operatorWith(canManagePromo);
  if (!op) return { error: 'forbidden' };
  const r = await accrueIbRevshare(moneyPool(), {
    partnerId: str(fd, 'id'),
    period: str(fd, 'period'),
    operatorId: op.operatorId,
    reason: str(fd, 'reason'),
  });
  if (!r.ok) return { error: r.reason === 'invalidPeriod' ? 'invalidPeriodValue' : r.reason };
  revalidatePath('/promo', 'layout');
  return { ok: true, detail: r.queued ? 'начисление поставлено в очередь' : 'доля за период — 0, начислять нечего' };
}

/* ── Настройки платформы (admin) ──────────────────────────────────────── */

export async function updatePromoSettingsAction(_prev: PromoActionState, fd: FormData): Promise<PromoActionState> {
  const op = await operatorWith(canManagePromo);
  if (!op) return { error: 'forbidden' };
  const r = await updatePromoSettings(moneyPool(), {
    operatorId: op.operatorId,
    reason: str(fd, 'reason'),
    next: {
      // Галочка формы — «акции ВЫКЛЮЧЕНЫ» (так её называет владелец).
      promotionsEnabled: fd.get('promotionsDisabled') !== 'on',
      attributionWindowDays: intField(fd, 'attributionWindowDays'),
      blockedCountries: countriesField(fd, 'blockedCountries'),
    },
  });
  revalidatePath('/settings');
  return r.ok ? { ok: true } : fail(r);
}
