import { appendJournalSeqWithinTx, inTransaction, isUniqueViolation, rollback, SYSTEM_OPERATORS, type PoolLike, type Queryable } from '@broker/money';
import { PROMO_ACTIONS, type RewardKind } from './actions';
import { ensureReferralCode } from './attribution-db';
import { maskName, type ContestStanding } from './contest';
import { contestPhase, readContestStandings, type ContestPhase } from './contest-db';
import { platformAllowsPromotions, promoAvailability, type Unavailability } from './eligibility';
import {
  computeCashback,
  evaluateDepositBonus,
  evaluateReferee,
  periodOf,
  type CashbackResult,
  type ConditionView,
  type EvaluationReason,
  type EvaluationState,
} from './evaluate';
import { readClientFacts, readPromoSettings, readPromotion, listPromotions, PROMOS_OFF, type PromotionRow } from './reader';
import type { ContestRules, PromotionType, ReferralRules } from './rules';

/**
 * API ДЛЯ КАБИНЕТА — функции, по которым кабинет строит экраны «Акции»,
 * «Пригласи друга», «Конкурс». Чтения — живые (оценка на лету, без записи);
 * записи — вступление в акцию и в конкурс.
 *
 * Тексты для клиента приходят из админки (`promotions.texts[locale]`), числа
 * — из правил. В коде экранов ни одного числа акции быть не должно.
 */

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

/* ── Публичное представление правил ───────────────────────────────────── */

export interface PromoTextView {
  title: string;
  summary: string;
  terms: string;
}

function textsFor(promo: PromotionRow, locale: string): PromoTextView {
  const t = promo.texts[locale] ?? promo.texts.ru ?? promo.texts.en ?? Object.values(promo.texts)[0];
  return { title: t?.title ?? promo.title, summary: t?.summary ?? '', terms: t?.terms ?? '' };
}

/** Числа правил для показа клиенту (без внутренних полей). */
export type PublicRules =
  | {
      type: 'deposit_bonus';
      percentBps: number;
      capMinor: number;
      minDepositMinor: number;
      firstDepositOnly: boolean;
      kycRequired: boolean;
      turnoverMultiplier: number;
      minHoldSeconds: number;
      windowDays: number;
      forfeitOnWithdrawal: boolean;
    }
  | { type: 'cashback'; percentBps: number; minPayoutMinor: number; capPerPeriodMinor: number; kycRequired: boolean }
  | {
      type: 'contest';
      startBalanceMinor: number;
      minTrades: number;
      prizes: { place: number; amountMinor: number }[];
      prizeRequiresKyc: boolean;
    }
  | {
      type: 'referral';
      referrerRewardMinor: number;
      refereeRewardMinor: number;
      kycRequired: boolean;
      minDepositMinor: number;
      turnoverNotionalMinor: number;
      minHoldSeconds: number;
      windowDays: number;
      maxPaidReferralsPerMonth: number;
    };

export function publicRules(promo: PromotionRow): PublicRules | null {
  const p = promo.parsed;
  if (!p) return null;
  switch (p.type) {
    case 'deposit_bonus':
      return { type: p.type, ...p.rules };
    case 'cashback':
      return { type: p.type, ...p.rules };
    case 'contest':
      return {
        type: p.type,
        startBalanceMinor: p.rules.startBalanceMinor,
        minTrades: p.rules.minTrades,
        prizes: [...p.rules.prizes].sort((a, b) => a.place - b.place),
        prizeRequiresKyc: p.rules.prizeRequiresKyc,
      };
    case 'referral': {
      const { forfeitOnWithdrawal: _f, ...rest } = p.rules;
      return { type: p.type, ...rest };
    }
  }
}

/* ── «Акции»: доступные / участвую / начислено ────────────────────────── */

export interface PromoCardView {
  id: string;
  slug: string;
  type: PromotionType;
  cmsPromoId: string | null;
  texts: PromoTextView;
  rules: PublicRules;
  startsAt: string | null;
  endsAt: string | null;
  /** Кнопка «Участвовать» (бонус, кешбэк). Конкурс — `joinContest`, реферальная — автоматически. */
  enrollable: boolean;
}

export interface ParticipationView {
  promotionId: string;
  slug: string;
  type: PromotionType;
  texts: PromoTextView;
  rules: PublicRules | null;
  status: 'enrolled' | 'qualified' | 'rewarded' | 'expired' | 'rejected' | 'not_eligible';
  enrolledAt: string;
  /** Живая оценка (для enrolled); для закрытых — последний снимок. */
  state: EvaluationState | null;
  reason: EvaluationReason | null;
  conditions: ConditionView[];
  deadline: string | null;
  expectedRewardMinor: number | null;
  /** Кешбэк: прогресс текущего месяца. */
  cashback: CashbackResult | null;
}

export type ClientRewardStatus = 'processing' | 'credited' | 'rejected';

export interface RewardView {
  id: string;
  kind: RewardKind;
  promotionId: string | null;
  promotionTitle: string | null;
  amountMinor: number;
  currency: string;
  period: string | null;
  /** Клиенту — три состояния: в обработке / начислено / отклонено. */
  status: ClientRewardStatus;
  /** Причина отказа (основание оператора) — показывается клиенту. */
  rejectReason: string | null;
  /** Связь с записью в истории счёта терминала. */
  externalRef: string;
  createdAt: string;
  creditedAt: string | null;
}

export interface ClientPromotionsView {
  /** Раздел акций доступен клиенту (платформа + страна). */
  enabled: boolean;
  disabledReason: 'platform_disabled' | 'country_blocked' | null;
  available: PromoCardView[];
  participating: ParticipationView[];
  rewards: RewardView[];
}

const clientStatus = (s: string): ClientRewardStatus =>
  s === 'credited' ? 'credited' : s === 'rejected' ? 'rejected' : 'processing';

export async function listClientRewards(db: Queryable, userId: string): Promise<RewardView[]> {
  const r = await db.query(
    `SELECT r.id::text AS id, r.kind, r.promotion_id::text AS promotion_id, p.title, p.texts, r.amount_minor, r.currency,
            r.period, r.status, r.reject_reason, r.external_ref, r.created_at, r.credited_at
       FROM promo_rewards r LEFT JOIN promotions p ON p.id = r.promotion_id
      WHERE r.user_id::text = $1
      ORDER BY r.created_at DESC`,
    [userId],
  );
  return r.rows.map((row) => ({
    id: String(row.id),
    kind: row.kind as RewardKind,
    promotionId: (row.promotion_id as string | null) ?? null,
    promotionTitle: (row.title as string | null) ?? null,
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency),
    period: (row.period as string | null) ?? null,
    status: clientStatus(String(row.status)),
    rejectReason: row.status === 'rejected' ? ((row.reject_reason as string | null) ?? null) : null,
    externalRef: String(row.external_ref),
    createdAt: iso(row.created_at),
    creditedAt: row.credited_at ? iso(row.credited_at) : null,
  }));
}

/**
 * Всё для раздела «Акции» кабинета. `locale` — язык текстов (из админки).
 * Платформа выключила акции / страна под запретом → `enabled: false` и пустые
 * списки доступного (начисленное всё равно показывается — это деньги клиента).
 */
export async function getClientPromotions(
  db: Queryable,
  userId: string,
  opts: { locale: string; now?: Date },
): Promise<ClientPromotionsView> {
  const now = opts.now ?? new Date();
  const settings = (await readPromoSettings(db)) ?? PROMOS_OFF;
  const u = await db.query(`SELECT country FROM users WHERE id::text = $1`, [userId]);
  const country = (u.rows[0]?.country as string | null) ?? null;
  const gate = platformAllowsPromotions(settings, country);
  const rewards = await listClientRewards(db, userId);

  const promos = await listPromotions(db);
  const byId = new Map(promos.map((p) => [p.id, p]));
  const parts = await db.query(
    `SELECT promotion_id::text AS promotion_id, status, enrolled_at, progress
       FROM promo_participations WHERE user_id::text = $1 ORDER BY enrolled_at DESC`,
    [userId],
  );

  const participating: ParticipationView[] = [];
  let facts: Awaited<ReturnType<typeof readClientFacts>> | undefined;
  for (const row of parts.rows) {
    const promo = byId.get(String(row.promotion_id));
    if (!promo) continue;
    const status = row.status as ParticipationView['status'];
    const enrolledAt = iso(row.enrolled_at);
    const snap = (row.progress ?? {}) as Record<string, unknown>;
    let view: ParticipationView = {
      promotionId: promo.id,
      slug: promo.slug,
      type: promo.type,
      texts: textsFor(promo, opts.locale),
      rules: publicRules(promo),
      status,
      enrolledAt,
      state: (snap.state as EvaluationState | undefined) ?? null,
      reason: (snap.reason as EvaluationReason | undefined) ?? null,
      conditions: Array.isArray(snap.conditions) ? (snap.conditions as ConditionView[]) : [],
      deadline: (snap.deadline as string | undefined) ?? null,
      expectedRewardMinor: (snap.rewardMinor as number | undefined) ?? null,
      cashback: null,
    };
    if (status === 'enrolled' && promo.parsed) {
      facts ??= await readClientFacts(db, userId);
      if (facts) {
        if (promo.parsed.type === 'deposit_bonus') {
          const ev = evaluateDepositBonus(promo.parsed.rules, { enrolledAt, promotionStartsAt: promo.startsAt }, facts, now);
          view = { ...view, state: ev.state, reason: ev.reason ?? null, conditions: ev.conditions, deadline: ev.deadline, expectedRewardMinor: ev.rewardMinor };
        } else if (promo.parsed.type === 'referral') {
          const ev = evaluateReferee(promo.parsed.rules, { attributedAt: enrolledAt, rewardMinor: promo.parsed.rules.refereeRewardMinor }, facts, now);
          view = { ...view, state: ev.state, reason: ev.reason ?? null, conditions: ev.conditions, deadline: ev.deadline, expectedRewardMinor: promo.parsed.rules.refereeRewardMinor };
        } else if (promo.parsed.type === 'cashback') {
          const cb = computeCashback(
            promo.parsed.rules,
            facts.trades.filter((t) => Date.parse(t.executedAt) >= Date.parse(enrolledAt)),
            periodOf(now),
          );
          view = { ...view, state: 'in_progress', cashback: cb, expectedRewardMinor: cb.cashbackMinor };
        }
      }
    }
    participating.push(view);
  }

  const enrolledIds = new Set(parts.rows.map((r) => String(r.promotion_id)));
  const available: PromoCardView[] = [];
  if (gate.allowed) {
    for (const promo of promos) {
      if (enrolledIds.has(promo.id) || promo.type === 'referral') continue;
      const rules = publicRules(promo);
      if (!rules) continue;
      const a = promoAvailability({ settings, promo, clientCountry: country, now });
      // Конкурс показывается и до старта (вступить можно заранее).
      const contestUpcoming = promo.type === 'contest' && !a.available && a.reason === 'not_started';
      if (!a.available && !contestUpcoming) continue;
      available.push({
        id: promo.id,
        slug: promo.slug,
        type: promo.type,
        cmsPromoId: promo.cmsPromoId,
        texts: textsFor(promo, opts.locale),
        rules,
        startsAt: promo.startsAt,
        endsAt: promo.endsAt,
        enrollable: promo.type === 'deposit_bonus' || promo.type === 'cashback',
      });
    }
  }

  return {
    enabled: gate.allowed,
    disabledReason: gate.allowed ? null : gate.reason,
    available,
    participating,
    rewards,
  };
}

export type EnrollResult =
  | { ok: true }
  | { ok: false; reason: Unavailability | 'not_found' | 'not_enrollable' | 'already_enrolled' };

/** «Участвовать» (бонус на депозит, кешбэк). Журнал — от имени кабинета. */
export async function enrollInPromotion(
  pool: PoolLike,
  input: { userId: string; promotionId: string; now?: Date },
): Promise<EnrollResult> {
  const now = input.now ?? new Date();
  try {
    return await inTransaction<EnrollResult>(pool, async (tx) => {
      const promo = await readPromotion(tx, input.promotionId);
      if (!promo) return rollback<EnrollResult>({ ok: false, reason: 'not_found' });
      if (promo.type !== 'deposit_bonus' && promo.type !== 'cashback') {
        return rollback<EnrollResult>({ ok: false, reason: 'not_enrollable' });
      }
      const settings = (await readPromoSettings(tx)) ?? PROMOS_OFF;
      const u = await tx.query(`SELECT country FROM users WHERE id::text = $1`, [input.userId]);
      if (!u.rows[0]) return rollback<EnrollResult>({ ok: false, reason: 'not_found' });
      const a = promoAvailability({ settings, promo, clientCountry: (u.rows[0].country as string | null) ?? null, now });
      if (!a.available) return rollback<EnrollResult>({ ok: false, reason: a.reason });
      const ins = await tx.query(
        `INSERT INTO promo_participations (promotion_id, user_id, status) VALUES ($1, $2, 'enrolled')
         ON CONFLICT (promotion_id, user_id) DO NOTHING RETURNING id::text AS id`,
        [promo.id, input.userId],
      );
      if (!ins.rows[0]) return rollback<EnrollResult>({ ok: false, reason: 'already_enrolled' });
      await appendJournalSeqWithinTx(
        {
          operatorId: SYSTEM_OPERATORS.cabinet,
          action: PROMO_ACTIONS.enrolled,
          subjectKind: 'client',
          subjectId: input.userId,
          payload: { promotionId: promo.id, slug: promo.slug, participationId: String(ins.rows[0].id) },
        },
        tx,
      );
      return { ok: true };
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, reason: 'already_enrolled' };
    throw e;
  }
}

/* ── «Пригласи друга» ─────────────────────────────────────────────────── */

export type InviteeStage = 'registered' | 'kyc' | 'deposit' | 'turnover' | 'qualified' | 'rewarded' | 'expired' | 'rejected';

export interface InviteeView {
  /** Маскированное имя: «Алексей М.». */
  displayName: string;
  registeredAt: string;
  stage: InviteeStage;
  conditions: ConditionView[];
  deadline: string | null;
  /** Моя награда за этого друга. */
  myReward: { amountMinor: number; status: ClientRewardStatus } | null;
}

export interface MyReferralView {
  enabled: boolean;
  disabledReason: 'platform_disabled' | 'country_blocked' | null;
  code: string;
  /** Ссылка: `linkBase` + `?ref=CODE`; `null`, если база ссылки не передана. */
  link: string | null;
  /** Действующая реферальная акция (условия и награды) — из админки. */
  program: { promotionId: string; texts: PromoTextView; rules: Extract<PublicRules, { type: 'referral' }> } | null;
  /** Клиент — IB-партнёр (у него свои условия, награды «друга» не платятся). */
  isPartner: boolean;
  invited: InviteeView[];
  totals: { invited: number; qualified: number; creditedMinor: number; processingMinor: number };
}

function stageOf(conditions: ConditionView[], status: string, state: EvaluationState | null): InviteeStage {
  if (status === 'rewarded') return 'rewarded';
  if (status === 'rejected') return 'rejected';
  if (status === 'qualified' || state === 'qualified') return 'qualified';
  if (status === 'expired' || state === 'expired' || state === 'not_eligible') return 'expired';
  const met = (k: string) => conditions.find((c) => c.key === k)?.met ?? true;
  if (!met('kyc')) return 'registered';
  if (!met('deposit')) return 'kyc';
  if (!met('turnover')) return 'deposit';
  return 'turnover';
}

/** «Пригласи друга»: код (создаётся лениво), ссылка, правила, приглашённые, награды. */
export async function getMyReferral(
  pool: PoolLike,
  userId: string,
  opts: { locale: string; linkBase?: string | null; now?: Date },
): Promise<MyReferralView> {
  const now = opts.now ?? new Date();
  const settings = (await readPromoSettings(pool)) ?? PROMOS_OFF;
  const u = await pool.query(`SELECT country FROM users WHERE id::text = $1`, [userId]);
  const gate = platformAllowsPromotions(settings, (u.rows[0]?.country as string | null) ?? null);
  const code = await ensureReferralCode(pool, userId);
  const base = opts.linkBase?.trim();
  const link = base ? `${base}${base.includes('?') ? '&' : '?'}ref=${encodeURIComponent(code)}` : null;

  const ib = await pool.query(`SELECT 1 FROM ib_partners WHERE user_id::text = $1 AND status = 'active'`, [userId]);
  const programs = (await listPromotions(pool, { type: 'referral' })).filter((p) => p.status === 'active' && p.parsed);
  const program = programs[0] ?? null;
  const rules = program?.parsed?.type === 'referral' ? (program.parsed.rules as ReferralRules) : null;

  const invitees = await pool.query(
    `SELECT ra.referee_user_id::text AS id, u.full_name, ra.attributed_at
       FROM referral_attributions ra JOIN users u ON u.id = ra.referee_user_id
      WHERE ra.referrer_user_id::text = $1 AND ra.status = 'active'
      ORDER BY ra.attributed_at DESC`,
    [userId],
  );
  const myRewards = await pool.query(
    `SELECT related_user_id::text AS friend, amount_minor, status FROM promo_rewards
      WHERE user_id::text = $1 AND kind IN ('referral', 'ib') AND related_user_id IS NOT NULL`,
    [userId],
  );
  const rewardByFriend = new Map(
    myRewards.rows.map((r) => [String(r.friend), { amountMinor: Number(r.amount_minor), status: clientStatus(String(r.status)) }]),
  );

  const invited: InviteeView[] = [];
  for (const inv of invitees.rows) {
    const friendId = String(inv.id);
    const attributedAt = iso(inv.attributed_at);
    let conditions: ConditionView[] = [];
    let deadline: string | null = null;
    let partStatus = 'enrolled';
    let state: EvaluationState | null = null;
    if (program && rules) {
      const part = await pool.query(
        `SELECT status FROM promo_participations WHERE promotion_id::text = $1 AND user_id::text = $2`,
        [program.id, friendId],
      );
      partStatus = (part.rows[0]?.status as string | undefined) ?? 'enrolled';
      const facts = await readClientFacts(pool, friendId, { tradesFrom: attributedAt });
      if (facts) {
        const ev = evaluateReferee(rules, { attributedAt, rewardMinor: rules.referrerRewardMinor }, facts, now);
        conditions = ev.conditions;
        deadline = ev.deadline;
        state = ev.state;
      }
    }
    const myReward = rewardByFriend.get(friendId) ?? null;
    invited.push({
      displayName: maskName(String(inv.full_name ?? '')),
      registeredAt: attributedAt,
      stage: myReward?.status === 'credited' ? 'rewarded' : stageOf(conditions, partStatus, state),
      conditions,
      deadline,
      myReward,
    });
  }

  const allMine = await pool.query(
    `SELECT status, amount_minor FROM promo_rewards WHERE user_id::text = $1 AND kind IN ('referral', 'ib')`,
    [userId],
  );
  let creditedMinor = 0;
  let processingMinor = 0;
  for (const r of allMine.rows) {
    if (r.status === 'credited') creditedMinor += Number(r.amount_minor);
    else if (r.status !== 'rejected') processingMinor += Number(r.amount_minor);
  }

  return {
    enabled: gate.allowed,
    disabledReason: gate.allowed ? null : gate.reason,
    code,
    link,
    program:
      program && rules
        ? { promotionId: program.id, texts: textsFor(program, opts.locale), rules: publicRules(program) as Extract<PublicRules, { type: 'referral' }> }
        : null,
    isPartner: ib.rows.length > 0,
    invited,
    totals: {
      invited: invited.length,
      qualified: invited.filter((i) => i.stage === 'qualified' || i.stage === 'rewarded').length,
      creditedMinor,
      processingMinor,
    },
  };
}

/* ── Конкурс ──────────────────────────────────────────────────────────── */

export interface ContestSummary {
  promotionId: string;
  slug: string;
  texts: PromoTextView;
  rules: Extract<PublicRules, { type: 'contest' }>;
  startsAt: string;
  endsAt: string;
  phase: ContestPhase;
  participants: number;
  /** Моё участие (если передан userId). */
  myStatus: 'pending_reset' | 'active' | 'disqualified' | 'withdrawn' | null;
}

export async function listContests(
  db: Queryable,
  opts: { locale: string; userId?: string | null; now?: Date },
): Promise<ContestSummary[]> {
  const now = opts.now ?? new Date();
  const promos = (await listPromotions(db, { type: 'contest' })).filter((p) => p.status !== 'draft' && p.parsed);
  const out: ContestSummary[] = [];
  for (const p of promos) {
    const fin = await db.query(`SELECT 1 FROM contest_snapshots WHERE promotion_id::text = $1 AND is_final`, [p.id]);
    const cnt = await db.query(
      `SELECT count(*)::int AS n FROM contest_entries WHERE promotion_id::text = $1 AND status IN ('active', 'pending_reset')`,
      [p.id],
    );
    let myStatus: ContestSummary['myStatus'] = null;
    if (opts.userId) {
      const me = await db.query(
        `SELECT status FROM contest_entries WHERE promotion_id::text = $1 AND user_id::text = $2`,
        [p.id, opts.userId],
      );
      myStatus = (me.rows[0]?.status as ContestSummary['myStatus']) ?? null;
    }
    out.push({
      promotionId: p.id,
      slug: p.slug,
      texts: textsFor(p, opts.locale),
      rules: publicRules(p) as Extract<PublicRules, { type: 'contest' }>,
      startsAt: p.startsAt!,
      endsAt: p.endsAt!,
      phase: contestPhase(p, fin.rows.length > 0, now),
      participants: Number(cnt.rows[0]?.n ?? 0),
      myStatus,
    });
  }
  return out;
}

export interface LeaderboardRow extends Omit<ContestStanding, 'userId' | 'displayName' | 'baselineMinor' | 'prizeBlockedByKyc'> {
  /** Маскированное имя. */
  displayName: string;
  isMe: boolean;
}

export interface ContestLeaderboard {
  contest: ContestSummary;
  /** Итоговый снимок (после подведения итогов) или живой расчёт. */
  final: boolean;
  computedAt: string;
  rows: LeaderboardRow[];
  me: LeaderboardRow | null;
}

/** Лидерборд конкурса и моё место. Имена маскированы; после итогов — из итогового снимка. */
export async function getContestLeaderboard(
  db: Queryable,
  promotionId: string,
  opts: { locale: string; userId?: string | null; limit?: number; now?: Date },
): Promise<ContestLeaderboard | null> {
  const now = opts.now ?? new Date();
  const promo = await readPromotion(db, promotionId);
  if (!promo || promo.type !== 'contest' || !promo.parsed || promo.parsed.type !== 'contest') return null;
  const contest = (await listContests(db, { locale: opts.locale, userId: opts.userId, now })).find((c) => c.promotionId === promo.id);
  if (!contest) return null;
  const snap = await db.query(
    `SELECT standings, taken_at FROM contest_snapshots WHERE promotion_id::text = $1 AND is_final`,
    [promo.id],
  );
  const final = snap.rows.length > 0;
  const standings: ContestStanding[] = final
    ? (snap.rows[0]!.standings as ContestStanding[])
    : await readContestStandings(db, promo, promo.parsed.rules as ContestRules, now);
  const rows: LeaderboardRow[] = standings.map((s) => ({
    place: s.place,
    returnBps: s.returnBps,
    pnlMinor: s.pnlMinor,
    tradesCount: s.tradesCount,
    ineligible: s.ineligible,
    prizeMinor: s.prizeMinor,
    displayName: maskName(s.displayName),
    isMe: !!opts.userId && s.userId === opts.userId,
  }));
  const me = rows.find((r) => r.isMe) ?? null;
  const limit = opts.limit ?? 50;
  return {
    contest,
    final,
    computedAt: final ? iso(snap.rows[0]!.taken_at) : now.toISOString(),
    rows: rows.filter((r) => r.place !== null).slice(0, limit),
    me,
  };
}
