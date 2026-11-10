import { appendJournalSeqWithinTx, inTransaction, isUniqueViolation, rollback, type PoolLike, type Queryable } from '@broker/money';
import { IB_ACTIONS, PROMO_ACTIONS, PROMO_SETTINGS_ACTION, REFERRAL_ACTIONS } from './actions';
import { normalizeEmail } from './antifraud';
import { ensureReferralCode } from './attribution-db';
import type { PlatformPromoSettings } from './eligibility';
import { readPromoSettings, readPromotion } from './reader';
import {
  ibCpaRules,
  normalizeCountries,
  parseRules,
  promoTextsSchema,
  type PromotionType,
} from './rules';

/**
 * ОПЕРАЦИИ АДМИНКИ зоны «Акции и партнёры». Образец — `lib/crypto/settings.ts`:
 * одно решение = одна транзакция, в ней правка И запись журнала (Р-049),
 * основание обязательно, пустой переход не пишется. Роль-гейт — у вызывающего
 * server action (автор — из сессии, Р-451).
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

export interface PromotionInput {
  slug: string;
  type: PromotionType;
  title: string;
  cmsPromoId: string | null;
  rules: unknown;
  texts: unknown;
  startsAt: string | null;
  endsAt: string | null;
  budgetMinor: number;
  countriesAllow: string[];
  countriesDeny: string[];
}

export type PromotionMutation =
  | { ok: true; id: string; journalSeq: number }
  | {
      ok: false;
      reason:
        | 'missingReason'
        | 'invalidSlug'
        | 'slugTaken'
        | 'invalidTitle'
        | 'invalidRules'
        | 'invalidTexts'
        | 'invalidPeriod'
        | 'invalidBudget'
        | 'budgetBelowSpent'
        | 'invalidCountries'
        | 'notFound'
        | 'notEditable'
        | 'noChange'
        | 'wrongTransition'
        | 'referralAlreadyActive';
      issues?: string[];
    };

type Normalized = Omit<PromotionInput, 'texts' | 'rules'> & { rules: unknown; texts: unknown };

function validate(input: PromotionInput): { ok: true; value: Normalized } | Extract<PromotionMutation, { ok: false }> {
  const slug = input.slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return { ok: false, reason: 'invalidSlug' };
  const title = input.title.trim();
  if (!title || title.length > 200) return { ok: false, reason: 'invalidTitle' };
  const rules = parseRules(input.type, input.rules);
  if (!rules.ok) return { ok: false, reason: 'invalidRules', issues: rules.issues };
  const texts = promoTextsSchema.safeParse(input.texts ?? {});
  if (!texts.success) return { ok: false, reason: 'invalidTexts', issues: texts.error.issues.map((i) => i.message) };
  const s = input.startsAt ? Date.parse(input.startsAt) : null;
  const e = input.endsAt ? Date.parse(input.endsAt) : null;
  if ((s !== null && Number.isNaN(s)) || (e !== null && Number.isNaN(e)) || (s !== null && e !== null && e <= s)) {
    return { ok: false, reason: 'invalidPeriod' };
  }
  if (input.type === 'contest' && (s === null || e === null)) return { ok: false, reason: 'invalidPeriod' };
  if (!Number.isSafeInteger(input.budgetMinor) || input.budgetMinor < 0) return { ok: false, reason: 'invalidBudget' };
  const allow = normalizeCountries(input.countriesAllow);
  const deny = normalizeCountries(input.countriesDeny);
  if (!allow || !deny) return { ok: false, reason: 'invalidCountries' };
  return {
    ok: true,
    value: {
      ...input,
      slug,
      title,
      cmsPromoId: input.cmsPromoId?.trim() || null,
      rules: rules.value.rules,
      texts: texts.data,
      startsAt: s === null ? null : new Date(s).toISOString(),
      endsAt: e === null ? null : new Date(e).toISOString(),
      countriesAllow: allow,
      countriesDeny: deny,
    },
  };
}

/** Создать акцию (черновик). Только admin. */
export async function createPromotion(
  pool: PoolLike,
  input: { operatorId: string; reason: string; promotion: PromotionInput },
): Promise<PromotionMutation> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'missingReason' };
  const v = validate(input.promotion);
  if (!v.ok) return v;
  const p = v.value;
  try {
    return await inTransaction<PromotionMutation>(pool, async (tx) => {
      const ins = await tx.query(
        `INSERT INTO promotions (slug, type, title, cms_promo_id, status, rules, texts, starts_at, ends_at,
                                 budget_minor, countries_allow, countries_deny, created_by)
         VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id::text AS id`,
        [
          p.slug,
          p.type,
          p.title,
          p.cmsPromoId,
          JSON.stringify(p.rules),
          JSON.stringify(p.texts),
          p.startsAt,
          p.endsAt,
          p.budgetMinor,
          p.countriesAllow,
          p.countriesDeny,
          input.operatorId,
        ],
      );
      const id = String(ins.rows[0]!.id);
      const seq = await appendJournalSeqWithinTx(
        {
          operatorId: input.operatorId,
          action: PROMO_ACTIONS.created,
          subjectKind: 'promotion',
          subjectId: id,
          payload: { basis: reason, slug: p.slug, type: p.type, title: p.title, rules: p.rules as Record<string, unknown>, budgetMinor: p.budgetMinor, startsAt: p.startsAt, endsAt: p.endsAt, countriesAllow: p.countriesAllow, countriesDeny: p.countriesDeny },
        },
        tx,
      );
      await tx.query(`UPDATE promotions SET last_journal_seq = $2 WHERE id = $1`, [id, seq]);
      return { ok: true, id, journalSeq: seq };
    });
  } catch (e) {
    if (isUniqueViolation(e, 'promotions_slug_uniq')) return { ok: false, reason: 'slugTaken' };
    throw e;
  }
}

/**
 * Изменить акцию: правила, тексты, период, бюджет, страны. Только в
 * `draft` / `paused` — у идущей акции правила под ногами участников не меняем
 * («поставьте на паузу»). Тип не меняется. Бюджет не ниже уже одобренного.
 */
export async function updatePromotion(
  pool: PoolLike,
  input: { operatorId: string; reason: string; id: string; promotion: Omit<PromotionInput, 'type'> },
): Promise<PromotionMutation> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'missingReason' };
  try {
    return await inTransaction<PromotionMutation>(pool, async (tx) => {
      const cur = await readPromotion(tx, input.id, true);
      if (!cur) return rollback<PromotionMutation>({ ok: false, reason: 'notFound' });
      if (cur.status !== 'draft' && cur.status !== 'paused') {
        return rollback<PromotionMutation>({ ok: false, reason: 'notEditable' });
      }
      const v = validate({ ...input.promotion, type: cur.type });
      if (!v.ok) return rollback<PromotionMutation>(v);
      const p = v.value;
      if (p.budgetMinor < cur.spentMinor) return rollback<PromotionMutation>({ ok: false, reason: 'budgetBelowSpent' });

      const before: Record<string, unknown> = {
        slug: cur.slug, title: cur.title, cmsPromoId: cur.cmsPromoId, rules: cur.rulesRaw, texts: cur.texts,
        startsAt: cur.startsAt, endsAt: cur.endsAt, budgetMinor: cur.budgetMinor,
        countriesAllow: cur.countriesAllow, countriesDeny: cur.countriesDeny,
      };
      const after: Record<string, unknown> = {
        slug: p.slug, title: p.title, cmsPromoId: p.cmsPromoId, rules: p.rules, texts: p.texts,
        startsAt: p.startsAt, endsAt: p.endsAt, budgetMinor: p.budgetMinor,
        countriesAllow: p.countriesAllow, countriesDeny: p.countriesDeny,
      };
      const changed = Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
      if (changed.length === 0) return rollback<PromotionMutation>({ ok: false, reason: 'noChange' });

      await tx.query(
        `UPDATE promotions SET slug = $2, title = $3, cms_promo_id = $4, rules = $5, texts = $6, starts_at = $7,
                ends_at = $8, budget_minor = $9, countries_allow = $10, countries_deny = $11, updated_at = now()
          WHERE id::text = $1`,
        [
          cur.id, p.slug, p.title, p.cmsPromoId, JSON.stringify(p.rules), JSON.stringify(p.texts), p.startsAt,
          p.endsAt, p.budgetMinor, p.countriesAllow, p.countriesDeny,
        ],
      );
      const pick = (o: Record<string, unknown>) => Object.fromEntries(changed.map((k) => [k, o[k] ?? null]));
      const seq = await appendJournalSeqWithinTx(
        {
          operatorId: input.operatorId,
          action: PROMO_ACTIONS.updated,
          subjectKind: 'promotion',
          subjectId: cur.id,
          payload: { basis: reason, changed, before: pick(before), after: pick(after) },
        },
        tx,
      );
      await tx.query(`UPDATE promotions SET last_journal_seq = $2 WHERE id::text = $1`, [cur.id, seq]);
      return { ok: true, id: cur.id, journalSeq: seq };
    });
  } catch (e) {
    if (isUniqueViolation(e, 'promotions_slug_uniq')) return { ok: false, reason: 'slugTaken' };
    throw e;
  }
}

const TRANSITIONS: Record<string, string[]> = {
  draft: ['active', 'ended'],
  active: ['paused', 'ended'],
  paused: ['active', 'ended'],
  ended: [],
};

const STATUS_ACTION: Record<string, string> = {
  active: PROMO_ACTIONS.activated,
  paused: PROMO_ACTIONS.paused,
  ended: PROMO_ACTIONS.ended,
};

/** Включить / поставить на паузу / завершить. Активная реферальная — одна на платформу. */
export async function setPromotionStatus(
  pool: PoolLike,
  input: { operatorId: string; reason: string; id: string; to: 'active' | 'paused' | 'ended' },
): Promise<PromotionMutation> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'missingReason' };
  return inTransaction<PromotionMutation>(pool, async (tx) => {
    const cur = await readPromotion(tx, input.id, true);
    if (!cur) return rollback<PromotionMutation>({ ok: false, reason: 'notFound' });
    if (!(TRANSITIONS[cur.status] ?? []).includes(input.to)) {
      return rollback<PromotionMutation>({ ok: false, reason: 'wrongTransition' });
    }
    if (input.to === 'active') {
      if (!cur.parsed) return rollback<PromotionMutation>({ ok: false, reason: 'invalidRules', issues: cur.ruleIssues });
      if (cur.type === 'referral') {
        const other = await tx.query(
          `SELECT 1 FROM promotions WHERE type = 'referral' AND status = 'active' AND id::text <> $1`,
          [cur.id],
        );
        if (other.rows.length > 0) return rollback<PromotionMutation>({ ok: false, reason: 'referralAlreadyActive' });
      }
    }
    await tx.query(`UPDATE promotions SET status = $2, updated_at = now() WHERE id::text = $1`, [cur.id, input.to]);
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: input.operatorId,
        action: STATUS_ACTION[input.to]!,
        subjectKind: 'promotion',
        subjectId: cur.id,
        payload: { basis: reason, from: cur.status, to: input.to, slug: cur.slug },
      },
      tx,
    );
    await tx.query(`UPDATE promotions SET last_journal_seq = $2 WHERE id::text = $1`, [cur.id, seq]);
    return { ok: true, id: cur.id, journalSeq: seq };
  });
}

/* ── Настройки платформы ──────────────────────────────────────────────── */

export type PromoSettingsResult =
  | { ok: true; journalSeq: number }
  | { ok: false; reason: 'missingReason' | 'invalidWindow' | 'invalidCountries' | 'noChange' };

export async function updatePromoSettings(
  pool: PoolLike,
  input: { operatorId: string; reason: string; next: PlatformPromoSettings },
): Promise<PromoSettingsResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'missingReason' };
  const w = input.next.attributionWindowDays;
  if (!Number.isInteger(w) || w < 1 || w > 365) return { ok: false, reason: 'invalidWindow' };
  const countries = normalizeCountries(input.next.blockedCountries);
  if (!countries) return { ok: false, reason: 'invalidCountries' };
  const next: PlatformPromoSettings = { ...input.next, blockedCountries: countries };
  return inTransaction<PromoSettingsResult>(pool, async (tx) => {
    await tx.query(`INSERT INTO platform_promo_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    await tx.query(`SELECT id FROM platform_promo_settings WHERE id = 1 FOR UPDATE`);
    const before = (await readPromoSettings(tx))!;
    const changed = (Object.keys(next) as (keyof PlatformPromoSettings)[]).filter(
      (k) => JSON.stringify(before[k]) !== JSON.stringify(next[k]),
    );
    if (changed.length === 0) return rollback<PromoSettingsResult>({ ok: false, reason: 'noChange' });
    await tx.query(
      `UPDATE platform_promo_settings
          SET promotions_enabled = $1, attribution_window_days = $2, blocked_countries = $3,
              updated_at = now(), updated_by = $4
        WHERE id = 1`,
      [next.promotionsEnabled, next.attributionWindowDays, next.blockedCountries, input.operatorId],
    );
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: input.operatorId,
        action: PROMO_SETTINGS_ACTION,
        subjectKind: 'platform',
        subjectId: 'promo_settings',
        payload: { basis: reason, changed, before: { ...before }, after: { ...next } },
      },
      tx,
    );
    await tx.query(`UPDATE platform_promo_settings SET last_journal_seq = $1 WHERE id = 1`, [seq]);
    return { ok: true, journalSeq: seq };
  });
}

/* ── Клиент по точному идентификатору (как привязка депозита) ─────────── */

export async function findClientExact(db: Queryable, q: string): Promise<{ id: string; email: string; fullName: string } | null> {
  const v = q.trim();
  if (!v) return null;
  const r = await db.query(
    `SELECT id::text AS id, email, full_name FROM users
      WHERE lower(email) = lower($1) OR id::text = $1 OR uid::text = $1
      LIMIT 2`,
    [v],
  );
  if (r.rows.length !== 1) return null;
  const row = r.rows[0]!;
  return { id: String(row.id), email: String(row.email), fullName: String(row.full_name) };
}

/* ── Рефералы: переназначение (admin, с основанием) ───────────────────── */

export type ReassignResult =
  | { ok: true; journalSeq: number }
  | { ok: false; reason: 'missingReason' | 'refereeNotFound' | 'referrerNotFound' | 'selfReferral' | 'noChange' };

/**
 * Переназначить реферера клиента (или снять атрибуцию: `referrer = null`).
 * Единственный путь перезаписи first-click — человек с основанием (решение
 * владельца №8). Уже выплаченные награды не отзываются — это делает сторно
 * (дорожная карта).
 */
export async function reassignReferral(
  pool: PoolLike,
  input: { operatorId: string; reason: string; refereeUserId: string; referrer: string | null },
): Promise<ReassignResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'missingReason' };
  return inTransaction<ReassignResult>(pool, async (tx) => {
    const referee = await tx.query(`SELECT id::text AS id, email FROM users WHERE id::text = $1`, [input.refereeUserId]);
    if (!referee.rows[0]) return rollback<ReassignResult>({ ok: false, reason: 'refereeNotFound' });
    let referrerId: string | null = null;
    if (input.referrer !== null) {
      const found = await findClientExact(tx, input.referrer);
      if (!found) return rollback<ReassignResult>({ ok: false, reason: 'referrerNotFound' });
      if (found.id === input.refereeUserId || normalizeEmail(found.email) === normalizeEmail(String(referee.rows[0].email))) {
        return rollback<ReassignResult>({ ok: false, reason: 'selfReferral' });
      }
      referrerId = found.id;
    }
    const cur = await tx.query(
      `SELECT referrer_user_id::text AS referrer, status FROM referral_attributions WHERE referee_user_id::text = $1 FOR UPDATE`,
      [input.refereeUserId],
    );
    const before = cur.rows[0] ? { referrer: (cur.rows[0].referrer as string | null) ?? null, status: String(cur.rows[0].status) } : null;
    if (referrerId === null && (!before || before.status === 'revoked')) return rollback<ReassignResult>({ ok: false, reason: 'noChange' });
    if (referrerId !== null && before?.referrer === referrerId && before.status === 'active') {
      return rollback<ReassignResult>({ ok: false, reason: 'noChange' });
    }
    let ibPartnerId: string | null = null;
    if (referrerId) {
      const ib = await tx.query(`SELECT id::text AS id FROM ib_partners WHERE user_id::text = $1 AND status = 'active'`, [referrerId]);
      ibPartnerId = (ib.rows[0]?.id as string | undefined) ?? null;
    }
    if (referrerId === null) {
      await tx.query(
        `UPDATE referral_attributions SET status = 'revoked', updated_at = now(), updated_by = $2 WHERE referee_user_id::text = $1`,
        [input.refereeUserId, input.operatorId],
      );
    } else {
      await tx.query(
        `INSERT INTO referral_attributions (referee_user_id, referrer_user_id, ib_partner_id, source, status, updated_by)
         VALUES ($1, $2, $3, 'manual', 'active', $4)
         ON CONFLICT (referee_user_id) DO UPDATE
           SET referrer_user_id = EXCLUDED.referrer_user_id, ib_partner_id = EXCLUDED.ib_partner_id,
               source = 'manual', status = 'active', reject_reason = NULL, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [input.refereeUserId, referrerId, ibPartnerId, input.operatorId],
      );
    }
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: input.operatorId,
        action: referrerId === null ? REFERRAL_ACTIONS.revoked : REFERRAL_ACTIONS.reassigned,
        subjectKind: 'client',
        subjectId: input.refereeUserId,
        payload: { basis: reason, before, after: referrerId === null ? null : { referrer: referrerId, ibPartnerId } },
      },
      tx,
    );
    await tx.query(`UPDATE referral_attributions SET last_journal_seq = $2 WHERE referee_user_id::text = $1`, [
      input.refereeUserId,
      seq,
    ]);
    return { ok: true, journalSeq: seq };
  });
}

/* ── IB-партнёры ──────────────────────────────────────────────────────── */

export interface IbPartnerInput {
  client: string;
  displayName: string;
  model: 'cpa' | 'revshare';
  cpaAmountMinor: number | null;
  cpaRules: unknown;
  revshareBps: number | null;
  status: 'active' | 'paused';
}

export type IbMutation =
  | { ok: true; id: string; journalSeq: number }
  | {
      ok: false;
      reason: 'missingReason' | 'clientNotFound' | 'invalidName' | 'invalidModel' | 'invalidRules' | 'alreadyPartner' | 'notFound' | 'noChange';
      issues?: string[];
    };

function validateIb(input: IbPartnerInput): { ok: true; rules: unknown } | Extract<IbMutation, { ok: false }> {
  if (!input.displayName.trim()) return { ok: false, reason: 'invalidName' };
  if (input.model === 'cpa') {
    if (!Number.isSafeInteger(input.cpaAmountMinor) || (input.cpaAmountMinor ?? 0) <= 0) return { ok: false, reason: 'invalidModel' };
    const r = ibCpaRules.safeParse(input.cpaRules);
    if (!r.success) return { ok: false, reason: 'invalidRules', issues: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
    return { ok: true, rules: r.data };
  }
  if (input.model === 'revshare') {
    if (!Number.isInteger(input.revshareBps) || (input.revshareBps ?? 0) < 1 || (input.revshareBps ?? 0) > 10_000) {
      return { ok: false, reason: 'invalidModel' };
    }
    return { ok: true, rules: {} };
  }
  return { ok: false, reason: 'invalidModel' };
}

export async function createIbPartner(
  pool: PoolLike,
  input: { operatorId: string; reason: string; partner: IbPartnerInput },
): Promise<IbMutation> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'missingReason' };
  const v = validateIb(input.partner);
  if (!v.ok) return v;
  const p = input.partner;
  try {
    return await inTransaction<IbMutation>(pool, async (tx) => {
      const client = await findClientExact(tx, p.client);
      if (!client) return rollback<IbMutation>({ ok: false, reason: 'clientNotFound' });
      const ins = await tx.query(
        `INSERT INTO ib_partners (user_id, display_name, model, cpa_amount_minor, cpa_rules, revshare_bps, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id::text AS id`,
        [
          client.id,
          p.displayName.trim(),
          p.model,
          p.model === 'cpa' ? p.cpaAmountMinor : null,
          JSON.stringify(v.rules),
          p.model === 'revshare' ? p.revshareBps : null,
          p.status,
          input.operatorId,
        ],
      );
      const id = String(ins.rows[0]!.id);
      const code = await ensureReferralCode(tx, client.id);
      const seq = await appendJournalSeqWithinTx(
        {
          operatorId: input.operatorId,
          action: IB_ACTIONS.created,
          subjectKind: 'ib_partner',
          subjectId: id,
          payload: {
            basis: reason,
            userId: client.id,
            displayName: p.displayName.trim(),
            model: p.model,
            cpaAmountMinor: p.model === 'cpa' ? p.cpaAmountMinor : null,
            cpaRules: v.rules as Record<string, unknown>,
            revshareBps: p.model === 'revshare' ? p.revshareBps : null,
            status: p.status,
            code,
          },
        },
        tx,
      );
      await tx.query(`UPDATE ib_partners SET last_journal_seq = $2 WHERE id = $1`, [id, seq]);
      return { ok: true, id, journalSeq: seq };
    });
  } catch (e) {
    if (isUniqueViolation(e, 'ib_partners_user_uniq')) return { ok: false, reason: 'alreadyPartner' };
    throw e;
  }
}

export async function updateIbPartner(
  pool: PoolLike,
  input: { operatorId: string; reason: string; id: string; partner: Omit<IbPartnerInput, 'client'> },
): Promise<IbMutation> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'missingReason' };
  const v = validateIb({ ...input.partner, client: '-' });
  if (!v.ok) return v;
  const p = input.partner;
  return inTransaction<IbMutation>(pool, async (tx) => {
    const cur = await tx.query(
      `SELECT display_name, model, cpa_amount_minor, cpa_rules, revshare_bps, status
         FROM ib_partners WHERE id::text = $1 FOR UPDATE`,
      [input.id],
    );
    const row = cur.rows[0];
    if (!row) return rollback<IbMutation>({ ok: false, reason: 'notFound' });
    const before = {
      displayName: String(row.display_name),
      model: String(row.model),
      cpaAmountMinor: row.cpa_amount_minor === null ? null : Number(row.cpa_amount_minor),
      cpaRules: row.cpa_rules as unknown,
      revshareBps: row.revshare_bps === null ? null : Number(row.revshare_bps),
      status: String(row.status),
    };
    const after = {
      displayName: p.displayName.trim(),
      model: p.model,
      cpaAmountMinor: p.model === 'cpa' ? p.cpaAmountMinor : null,
      cpaRules: v.rules,
      revshareBps: p.model === 'revshare' ? p.revshareBps : null,
      status: p.status,
    };
    const changed = (Object.keys(after) as (keyof typeof after)[]).filter(
      (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]),
    );
    if (changed.length === 0) return rollback<IbMutation>({ ok: false, reason: 'noChange' });
    await tx.query(
      `UPDATE ib_partners SET display_name = $2, model = $3, cpa_amount_minor = $4, cpa_rules = $5, revshare_bps = $6,
              status = $7, updated_at = now()
        WHERE id::text = $1`,
      [input.id, after.displayName, after.model, after.cpaAmountMinor, JSON.stringify(after.cpaRules), after.revshareBps, after.status],
    );
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: input.operatorId,
        action: IB_ACTIONS.updated,
        subjectKind: 'ib_partner',
        subjectId: input.id,
        payload: {
          basis: reason,
          changed,
          before: Object.fromEntries(changed.map((k) => [k, before[k] ?? null])),
          after: Object.fromEntries(changed.map((k) => [k, after[k] ?? null])),
        },
      },
      tx,
    );
    await tx.query(`UPDATE ib_partners SET last_journal_seq = $2 WHERE id::text = $1`, [input.id, seq]);
    return { ok: true, id: input.id, journalSeq: seq };
  });
}
