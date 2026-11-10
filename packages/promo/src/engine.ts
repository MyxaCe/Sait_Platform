import { appendJournalSeqWithinTx, inTransaction, rollback, type PoolLike, type Queryable } from '@broker/money';
import {
  CASHBACK_ACTIONS,
  CONTEST_ACTIONS,
  IB_ACTIONS,
  PROMO_ACTIONS,
  PROMO_ENGINE_OPERATOR,
} from './actions';
import type { LinkSignal } from './antifraud';
import { readContestStandings } from './contest-db';
import { promoAvailability, type PlatformPromoSettings } from './eligibility';
import {
  computeCashback,
  evaluateDepositBonus,
  evaluateReferee,
  isPeriod,
  periodBounds,
  periodOf,
  platformRevenueMinor,
  revshareMinor,
  type Evaluation,
} from './evaluate';
import { ms } from './facts';
import { enqueueRewardWithinTx } from './queue';
import { mapTrade, readClientFacts, readLinkSignals, readPromoSettings, readPromotion, type PromotionRow } from './reader';
import { rewardRef } from './refs';
import { ibCpaRules, type ContestRules, type DepositBonusRules, type ReferralRules } from './rules';

/**
 * ДВИЖОК ОЧЕРЕДИ: оценить участников и поставить выполнивших условия в очередь
 * начислений. Денег не двигает — только заявки (`promo_rewards.pending`).
 *
 * Для демо запускается кнопкой оператора «Пересчитать» (и сидом); для боя —
 * воркером по событиям (дизайн §3.5). Каждый клиент — своя транзакция: сбой
 * одного не откатывает остальных. Повтор безопасен: начисления уникальны по
 * external_ref, участие — по (акция, клиент).
 */

export interface SyncReport {
  evaluated: number;
  queued: number;
  expired: number;
  skipped?: 'platform_disabled' | 'bad_rules' | 'not_active' | 'not_found' | 'unsupported_type';
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

function budgetSignal(promo: { budgetMinor: number; spentMinor: number }, amount: number): LinkSignal[] {
  return promo.budgetMinor - promo.spentMinor < amount
    ? [{ kind: 'budget_insufficient', value: String(promo.budgetMinor - promo.spentMinor) }]
    : [];
}

function countryAllowed(settings: PlatformPromoSettings, promo: PromotionRow, country: string | null, now: Date) {
  return promoAvailability({
    settings,
    promo: { ...promo, status: 'active', startsAt: null, endsAt: null },
    clientCountry: country,
    now,
  }).available;
}

function progressJson(ev: Evaluation): string {
  return JSON.stringify({
    state: ev.state,
    reason: ev.reason ?? null,
    conditions: ev.conditions,
    rewardMinor: ev.rewardMinor,
    baseDepositId: ev.baseDepositId,
    deadline: ev.deadline,
    turnover: ev.turnover ?? null,
  });
}

async function promotionGate(
  db: Queryable,
  promotionId: string,
): Promise<{ promo: PromotionRow; settings: PlatformPromoSettings } | { skipped: SyncReport['skipped'] }> {
  const settings = await readPromoSettings(db);
  if (!settings || !settings.promotionsEnabled) return { skipped: 'platform_disabled' };
  const promo = await readPromotion(db, promotionId);
  if (!promo) return { skipped: 'not_found' };
  if (!promo.parsed) return { skipped: 'bad_rules' };
  if (promo.status !== 'active' && promo.status !== 'ended') return { skipped: 'not_active' };
  return { promo, settings };
}

/** Пересчитать акцию (бонус на депозит / реферальную) и пополнить очередь. */
export async function syncPromotionQueue(pool: PoolLike, promotionId: string, now: Date = new Date()): Promise<SyncReport> {
  const gate = await promotionGate(pool, promotionId);
  if ('skipped' in gate) return { evaluated: 0, queued: 0, expired: 0, skipped: gate.skipped };
  const { promo, settings } = gate;
  if (promo.parsed!.type === 'deposit_bonus') return syncDepositBonus(pool, promo, promo.parsed!.rules, settings, now);
  if (promo.parsed!.type === 'referral') return syncReferral(pool, promo, promo.parsed!.rules, settings, now);
  return { evaluated: 0, queued: 0, expired: 0, skipped: 'unsupported_type' };
}

async function syncDepositBonus(
  pool: PoolLike,
  promo: PromotionRow,
  rules: DepositBonusRules,
  settings: PlatformPromoSettings,
  now: Date,
): Promise<SyncReport> {
  const parts = await pool.query(
    `SELECT id::text AS id, user_id::text AS user_id, enrolled_at FROM promo_participations
      WHERE promotion_id::text = $1 AND status = 'enrolled' ORDER BY enrolled_at`,
    [promo.id],
  );
  const report: SyncReport = { evaluated: 0, queued: 0, expired: 0 };
  for (const p of parts.rows) {
    const userId = String(p.user_id);
    const enrolledAt = iso(p.enrolled_at);
    const outcome = await inTransaction(pool, async (tx) => {
      const lock = await tx.query(
        `SELECT status FROM promo_participations WHERE id::text = $1 FOR UPDATE`,
        [p.id],
      );
      if (lock.rows[0]?.status !== 'enrolled') return rollback('skip' as const);
      const facts = await readClientFacts(tx, userId, { tradesFrom: enrolledAt });
      if (!facts) return rollback('skip' as const);
      const ev = evaluateDepositBonus(rules, { enrolledAt, promotionStartsAt: promo.startsAt }, facts, now);
      const status =
        ev.state === 'qualified' ? 'qualified' : ev.state === 'expired' ? 'expired' : ev.state === 'not_eligible' ? 'not_eligible' : 'enrolled';
      if (status === 'qualified' && !countryAllowed(settings, promo, facts.country, now)) {
        // Страна клиента под запретом — в очередь не ставим, участие ждёт.
        await tx.query(
          `UPDATE promo_participations SET progress = $2, evaluated_at = now(), updated_at = now() WHERE id::text = $1`,
          [p.id, progressJson(ev)],
        );
        return 'evaluated' as const;
      }
      await tx.query(
        `UPDATE promo_participations SET status = $2, progress = $3, evaluated_at = now(), updated_at = now()
          WHERE id::text = $1`,
        [p.id, status, progressJson(ev)],
      );
      if (status === 'expired' || status === 'not_eligible') {
        await appendJournalSeqWithinTx(
          {
            operatorId: PROMO_ENGINE_OPERATOR,
            action: PROMO_ACTIONS.expired,
            subjectKind: 'client',
            subjectId: userId,
            payload: { promotionId: promo.id, participationId: p.id, state: ev.state, why: ev.reason ?? null },
          },
          tx,
        );
        return 'expired' as const;
      }
      if (status !== 'qualified' || !ev.rewardMinor) return 'evaluated' as const;
      const signals = [...(await readLinkSignals(tx, userId)), ...budgetSignal(promo, ev.rewardMinor)];
      const q = await enqueueRewardWithinTx(tx, {
        kind: 'promo',
        promotionId: promo.id,
        participationId: String(p.id),
        userId,
        amountMinor: ev.rewardMinor,
        externalRef: rewardRef.promo(promo.id, userId),
        basis: {
          promotion: promo.slug,
          percentBps: rules.percentBps,
          capMinor: rules.capMinor,
          baseDepositId: ev.baseDepositId,
          baseDepositMinor: ev.conditions.find((c) => c.key === 'deposit')?.current ?? null,
          turnover: ev.turnover ?? null,
          enrolledAt,
          deadline: ev.deadline,
        },
        signals,
      });
      return q.created ? ('queued' as const) : ('evaluated' as const);
    });
    if (outcome === 'skip') continue;
    report.evaluated += 1;
    if (outcome === 'queued') report.queued += 1;
    if (outcome === 'expired') report.expired += 1;
  }
  return report;
}

/** Оплачено (не отклонено) наград рефереру в календарном месяце `now`. */
async function referrerPaidThisMonth(db: Queryable, referrerUserId: string, now: Date): Promise<number> {
  const { from, until } = periodBounds(periodOf(now));
  const r = await db.query(
    `SELECT count(*)::int AS n FROM promo_rewards
      WHERE kind = 'referral' AND user_id::text = $1 AND external_ref LIKE 'ref:%:referrer'
        AND status <> 'rejected' AND created_at BETWEEN $2 AND $3`,
    [referrerUserId, from, until],
  );
  return Number(r.rows[0]?.n ?? 0);
}

async function syncReferral(
  pool: PoolLike,
  promo: PromotionRow,
  rules: ReferralRules,
  settings: PlatformPromoSettings,
  now: Date,
): Promise<SyncReport> {
  // Друзья, приведённые клиентами (не IB — у партнёров свои условия), в период акции.
  const pairs = await pool.query(
    `SELECT ra.referee_user_id::text AS referee, ra.referrer_user_id::text AS referrer, ra.attributed_at
       FROM referral_attributions ra
      WHERE ra.status = 'active' AND ra.referrer_user_id IS NOT NULL AND ra.ib_partner_id IS NULL
        AND ($1::timestamptz IS NULL OR ra.attributed_at >= $1)
        AND ($2::timestamptz IS NULL OR ra.attributed_at <= $2)
      ORDER BY ra.attributed_at`,
    [promo.startsAt, promo.endsAt],
  );
  const report: SyncReport = { evaluated: 0, queued: 0, expired: 0 };
  for (const pair of pairs.rows) {
    const referee = String(pair.referee);
    const referrer = String(pair.referrer);
    const attributedAt = iso(pair.attributed_at);
    const outcome = await inTransaction(pool, async (tx) => {
      await tx.query(
        `INSERT INTO promo_participations (promotion_id, user_id, status, enrolled_at)
         VALUES ($1, $2, 'enrolled', $3) ON CONFLICT (promotion_id, user_id) DO NOTHING`,
        [promo.id, referee, attributedAt],
      );
      const part = await tx.query(
        `SELECT id::text AS id, status FROM promo_participations
          WHERE promotion_id::text = $1 AND user_id::text = $2 FOR UPDATE`,
        [promo.id, referee],
      );
      const row = part.rows[0];
      if (!row || row.status !== 'enrolled') return rollback('skip' as const);
      const facts = await readClientFacts(tx, referee, { tradesFrom: attributedAt });
      if (!facts) return rollback('skip' as const);
      const ev = evaluateReferee(rules, { attributedAt, rewardMinor: Math.max(rules.refereeRewardMinor, rules.referrerRewardMinor) }, facts, now);
      const status = ev.state === 'qualified' ? 'qualified' : ev.state === 'expired' ? 'expired' : ev.state === 'not_eligible' ? 'not_eligible' : 'enrolled';
      if (status === 'qualified' && !countryAllowed(settings, promo, facts.country, now)) {
        await tx.query(
          `UPDATE promo_participations SET progress = $2, evaluated_at = now(), updated_at = now() WHERE id::text = $1`,
          [row.id, progressJson(ev)],
        );
        return 'evaluated' as const;
      }
      let queued = 0;
      let referrerCapped = false;
      if (status === 'qualified') {
        if (rules.refereeRewardMinor > 0) {
          const q = await enqueueRewardWithinTx(tx, {
            kind: 'referral',
            promotionId: promo.id,
            participationId: String(row.id),
            userId: referee,
            relatedUserId: referrer,
            amountMinor: rules.refereeRewardMinor,
            externalRef: rewardRef.referral(referee, 'referee'),
            basis: { promotion: promo.slug, role: 'referee', attributedAt, turnover: ev.turnover ?? null, deadline: ev.deadline },
            signals: [
              ...(await readLinkSignals(tx, referee, referrer)),
              ...budgetSignal(promo, rules.refereeRewardMinor + rules.referrerRewardMinor),
            ],
          });
          if (q.created) queued += 1;
        }
        if (rules.referrerRewardMinor > 0) {
          const paid = await referrerPaidThisMonth(tx, referrer, now);
          if (rules.maxPaidReferralsPerMonth > 0 && paid >= rules.maxPaidReferralsPerMonth) {
            referrerCapped = true;
          } else {
            const q = await enqueueRewardWithinTx(tx, {
              kind: 'referral',
              promotionId: promo.id,
              userId: referrer,
              relatedUserId: referee,
              amountMinor: rules.referrerRewardMinor,
              externalRef: rewardRef.referral(referee, 'referrer'),
              basis: { promotion: promo.slug, role: 'referrer', friend: referee, attributedAt, paidThisMonth: paid },
              signals: [...(await readLinkSignals(tx, referrer, referee)), ...budgetSignal(promo, rules.referrerRewardMinor)],
            });
            if (q.created) queued += 1;
          }
        }
      }
      await tx.query(
        `UPDATE promo_participations SET status = $2, progress = $3, evaluated_at = now(), updated_at = now()
          WHERE id::text = $1`,
        [
          row.id,
          status,
          JSON.stringify({ ...JSON.parse(progressJson(ev)), referrerUserId: referrer, referrerCapped }),
        ],
      );
      if (status === 'expired' || status === 'not_eligible') return 'expired' as const;
      return queued > 0 ? ('queued' as const) : ('evaluated' as const);
    });
    if (outcome === 'skip') continue;
    report.evaluated += 1;
    if (outcome === 'queued') report.queued += 1;
    if (outcome === 'expired') report.expired += 1;
  }
  return report;
}

/* ── Кешбэк за период ─────────────────────────────────────────────────── */

export type AccrueResult =
  | { ok: true; queued: number; zero: number; period: string }
  | { ok: false; reason: 'missingReason' | 'invalidPeriod' | 'periodOpen' | 'notFound' | 'wrongType' | 'platformDisabled' | 'badRules' };

/**
 * Начислить кешбэк за ЗАКРЫТЫЙ месяц всем вступившим: % от их наценки +
 * комиссии за период (после вступления). Без полей комиссии в сделках — 0.
 */
export async function accrueCashback(
  pool: PoolLike,
  input: { promotionId: string; period: string; operatorId: string; reason: string; now?: Date },
): Promise<AccrueResult> {
  const now = input.now ?? new Date();
  if (!input.reason.trim()) return { ok: false, reason: 'missingReason' };
  if (!isPeriod(input.period)) return { ok: false, reason: 'invalidPeriod' };
  const { from, until } = periodBounds(input.period);
  if (ms(until) >= now.getTime()) return { ok: false, reason: 'periodOpen' };
  const settings = await readPromoSettings(pool);
  if (!settings?.promotionsEnabled) return { ok: false, reason: 'platformDisabled' };
  const promo = await readPromotion(pool, input.promotionId);
  if (!promo) return { ok: false, reason: 'notFound' };
  if (promo.type !== 'cashback') return { ok: false, reason: 'wrongType' };
  if (!promo.parsed || promo.parsed.type !== 'cashback') return { ok: false, reason: 'badRules' };
  const rules = promo.parsed.rules;

  const parts = await pool.query(
    `SELECT pp.id::text AS id, pp.user_id::text AS user_id, pp.enrolled_at, u.country, cv.state AS kyc
       FROM promo_participations pp
       JOIN users u ON u.id = pp.user_id
       LEFT JOIN client_verification cv ON cv.user_id = pp.user_id
      WHERE pp.promotion_id::text = $1 AND pp.status IN ('enrolled', 'qualified', 'rewarded') AND pp.enrolled_at <= $2`,
    [promo.id, until],
  );
  let queued = 0;
  let zero = 0;
  for (const p of parts.rows) {
    const userId = String(p.user_id);
    if (rules.kycRequired && p.kyc !== 'verified') {
      zero += 1;
      continue;
    }
    if (!countryAllowed(settings, promo, (p.country as string | null) ?? null, now)) {
      zero += 1;
      continue;
    }
    const startFrom = ms(iso(p.enrolled_at)) > ms(from) ? iso(p.enrolled_at) : from;
    const trades = await pool.query(
      `SELECT symbol, side, volume, price, executed_at, commission_minor, markup_minor, realized_pnl_cents
         FROM real_trades WHERE user_id::text = $1 AND executed_at >= $2 AND executed_at <= $3`,
      [userId, startFrom, until],
    );
    const cb = computeCashback(rules, trades.rows.map(mapTrade), input.period);
    if (cb.cashbackMinor <= 0) {
      zero += 1;
      continue;
    }
    const created = await inTransaction(pool, async (tx) => {
      const q = await enqueueRewardWithinTx(tx, {
        kind: 'cashback',
        promotionId: promo.id,
        participationId: String(p.id),
        userId,
        amountMinor: cb.cashbackMinor,
        period: input.period,
        externalRef: rewardRef.cashback(promo.id, input.period, userId),
        basis: {
          promotion: promo.slug,
          period: input.period,
          feesMinor: cb.feesMinor,
          percentBps: rules.percentBps,
          tradesWithoutFees: cb.tradesWithoutFees,
        },
        signals: [...(await readLinkSignals(tx, userId)), ...budgetSignal(promo, cb.cashbackMinor)],
      });
      return q.created;
    });
    if (created) queued += 1;
  }
  await inTransaction(pool, async (tx) => {
    await appendJournalSeqWithinTx(
      {
        operatorId: input.operatorId,
        action: CASHBACK_ACTIONS.accrued,
        subjectKind: 'promotion',
        subjectId: promo.id,
        payload: { basis: input.reason.trim(), period: input.period, queued, zero },
      },
      tx,
    );
  });
  return { ok: true, queued, zero, period: input.period };
}

/* ── IB-партнёры ──────────────────────────────────────────────────────── */

/** CPA: квалифицированные клиенты партнёров → в очередь (ib:cpa:<клиент>). */
export async function syncIbCpa(pool: PoolLike, now: Date = new Date()): Promise<SyncReport> {
  const settings = await readPromoSettings(pool);
  if (!settings?.promotionsEnabled) return { evaluated: 0, queued: 0, expired: 0, skipped: 'platform_disabled' };
  const rows = await pool.query(
    `SELECT p.id::text AS partner_id, p.user_id::text AS partner_user, p.cpa_amount_minor, p.cpa_rules,
            ra.referee_user_id::text AS client, ra.attributed_at
       FROM ib_partners p
       JOIN referral_attributions ra ON ra.ib_partner_id = p.id AND ra.status = 'active'
      WHERE p.status = 'active' AND p.model = 'cpa'
        AND NOT EXISTS (SELECT 1 FROM promo_rewards r WHERE r.external_ref = 'ib:cpa:' || ra.referee_user_id::text)`,
  );
  const report: SyncReport = { evaluated: 0, queued: 0, expired: 0 };
  for (const r of rows.rows) {
    const rules = ibCpaRules.safeParse(r.cpa_rules);
    if (!rules.success) continue;
    const client = String(r.client);
    const attributedAt = iso(r.attributed_at);
    const facts = await readClientFacts(pool, client, { tradesFrom: attributedAt });
    if (!facts) continue;
    report.evaluated += 1;
    const amount = Number(r.cpa_amount_minor);
    const ev = evaluateReferee(rules.data, { attributedAt, rewardMinor: amount }, facts, now);
    if (ev.state !== 'qualified') {
      if (ev.state === 'expired') report.expired += 1;
      continue;
    }
    const created = await inTransaction(pool, async (tx) => {
      const q = await enqueueRewardWithinTx(tx, {
        kind: 'ib',
        promotionId: null,
        ibPartnerId: String(r.partner_id),
        userId: String(r.partner_user),
        relatedUserId: client,
        amountMinor: amount,
        externalRef: rewardRef.ibCpa(client),
        basis: { model: 'cpa', client, attributedAt, turnover: ev.turnover ?? null },
        signals: await readLinkSignals(tx, String(r.partner_user), client),
      });
      return q.created;
    });
    if (created) report.queued += 1;
  }
  return report;
}

/** Revshare: доля дохода платформы (наценка + комиссия) с клиентов партнёра за закрытый месяц. */
export async function accrueIbRevshare(
  pool: PoolLike,
  input: { partnerId: string; period: string; operatorId: string; reason: string; now?: Date },
): Promise<{ ok: true; amountMinor: number; revenueMinor: number; queued: boolean } | { ok: false; reason: string }> {
  const now = input.now ?? new Date();
  if (!input.reason.trim()) return { ok: false, reason: 'missingReason' };
  if (!isPeriod(input.period)) return { ok: false, reason: 'invalidPeriod' };
  const { from, until } = periodBounds(input.period);
  if (ms(until) >= now.getTime()) return { ok: false, reason: 'periodOpen' };
  const p = await pool.query(
    `SELECT id::text AS id, user_id::text AS user_id, model, revshare_bps, status FROM ib_partners WHERE id::text = $1`,
    [input.partnerId],
  );
  const partner = p.rows[0];
  if (!partner) return { ok: false, reason: 'notFound' };
  if (partner.model !== 'revshare') return { ok: false, reason: 'wrongType' };
  const trades = await pool.query(
    `SELECT rt.executed_at, rt.commission_minor, rt.markup_minor
       FROM real_trades rt
       JOIN referral_attributions ra ON ra.referee_user_id = rt.user_id
      WHERE ra.ib_partner_id::text = $1 AND ra.status = 'active'
        AND rt.executed_at >= GREATEST($2::timestamptz, ra.attributed_at) AND rt.executed_at <= $3`,
    [input.partnerId, from, until],
  );
  const revenue = platformRevenueMinor(
    trades.rows.map((t) => ({
      executedAt: iso(t.executed_at),
      commissionMinor: t.commission_minor === null ? null : Number(t.commission_minor),
      markupMinor: t.markup_minor === null ? null : Number(t.markup_minor),
    })),
    input.period,
  );
  const amount = revshareMinor(revenue, Number(partner.revshare_bps));
  const queued = await inTransaction(pool, async (tx) => {
    let created = false;
    if (amount > 0) {
      const q = await enqueueRewardWithinTx(tx, {
        kind: 'ib',
        promotionId: null,
        ibPartnerId: input.partnerId,
        userId: String(partner.user_id),
        amountMinor: amount,
        period: input.period,
        externalRef: rewardRef.ibRevshare(input.partnerId, input.period),
        basis: { model: 'revshare', period: input.period, revenueMinor: revenue, revshareBps: Number(partner.revshare_bps) },
        signals: await readLinkSignals(tx, String(partner.user_id)),
      });
      created = q.created;
    }
    await appendJournalSeqWithinTx(
      {
        operatorId: input.operatorId,
        action: IB_ACTIONS.revshareAccrued,
        subjectKind: 'ib_partner',
        subjectId: input.partnerId,
        payload: { basis: input.reason.trim(), period: input.period, revenueMinor: revenue, amountMinor: amount, queued: created },
      },
      tx,
    );
    return created;
  });
  return { ok: true, amountMinor: amount, revenueMinor: revenue, queued };
}

/* ── Конкурс: итоги ───────────────────────────────────────────────────── */

export type FinalizeResult =
  | { ok: true; queued: number; standings: number }
  | { ok: false; reason: 'missingReason' | 'notFound' | 'wrongType' | 'notFinished' | 'alreadyFinal' | 'badRules' };

/**
 * Подвести итоги конкурса (после окончания периода): итоговый снимок
 * лидерборда + призы в очередь начислений (`contest:<акция>:<место>`), акция
 * → `ended`. Приз без KYC (если правила требуют) в очередь не идёт — он виден
 * в снимке с пометкой.
 */
export async function finalizeContest(
  pool: PoolLike,
  input: { promotionId: string; operatorId: string; reason: string; now?: Date },
): Promise<FinalizeResult> {
  const now = input.now ?? new Date();
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'missingReason' };
  return inTransaction<FinalizeResult>(pool, async (tx) => {
    const promo = await readPromotion(tx, input.promotionId, true);
    if (!promo) return rollback<FinalizeResult>({ ok: false, reason: 'notFound' });
    if (promo.type !== 'contest') return rollback<FinalizeResult>({ ok: false, reason: 'wrongType' });
    if (!promo.parsed || promo.parsed.type !== 'contest') return rollback<FinalizeResult>({ ok: false, reason: 'badRules' });
    if (!promo.endsAt || ms(promo.endsAt) > now.getTime()) return rollback<FinalizeResult>({ ok: false, reason: 'notFinished' });
    const fin = await tx.query(`SELECT 1 FROM contest_snapshots WHERE promotion_id::text = $1 AND is_final`, [promo.id]);
    if (fin.rows.length > 0) return rollback<FinalizeResult>({ ok: false, reason: 'alreadyFinal' });

    const rules: ContestRules = promo.parsed.rules;
    const standings = await readContestStandings(tx, promo, rules, now);
    await tx.query(
      `INSERT INTO contest_snapshots (promotion_id, is_final, standings, taken_by) VALUES ($1, true, $2, $3)`,
      [promo.id, JSON.stringify(standings), input.operatorId],
    );
    let queued = 0;
    for (const s of standings) {
      if (s.place === null || s.prizeMinor === null || s.prizeBlockedByKyc) continue;
      const q = await enqueueRewardWithinTx(tx, {
        kind: 'contest',
        promotionId: promo.id,
        userId: s.userId,
        amountMinor: s.prizeMinor,
        externalRef: rewardRef.contest(promo.id, s.place),
        basis: {
          promotion: promo.slug,
          place: s.place,
          returnBps: s.returnBps,
          pnlMinor: s.pnlMinor,
          tradesCount: s.tradesCount,
          baselineMinor: s.baselineMinor,
        },
        signals: [...(await readLinkSignals(tx, s.userId)), ...budgetSignal(promo, s.prizeMinor)],
      });
      if (q.created) queued += 1;
    }
    await tx.query(`UPDATE promotions SET status = 'ended', updated_at = now() WHERE id = $1`, [promo.id]);
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: input.operatorId,
        action: CONTEST_ACTIONS.finalized,
        subjectKind: 'promotion',
        subjectId: promo.id,
        payload: {
          basis: reason,
          winners: standings
            .filter((s) => s.place !== null && s.prizeMinor !== null)
            .map((s) => ({ place: s.place, userId: s.userId, prizeMinor: s.prizeMinor, kycBlocked: s.prizeBlockedByKyc })),
          queued,
        },
      },
      tx,
    );
    await tx.query(`UPDATE promotions SET last_journal_seq = $2 WHERE id = $1`, [promo.id, seq]);
    return { ok: true, queued, standings: standings.length };
  });
}
