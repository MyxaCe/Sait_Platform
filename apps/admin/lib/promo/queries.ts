import {
  listPromotions,
  parseSignals,
  readPromoSettings,
  readPromotion,
  type LinkSignal,
  type PlatformPromoSettings,
  type PromotionRow,
} from '@broker/promo';
import { getPool, type Queryable } from '../db';

/**
 * Чтения зоны «Акции и партнёры» для админки. Чтения не журналируются.
 */

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export async function getPromoSettings(db: Queryable = getPool()): Promise<PlatformPromoSettings | null> {
  return readPromoSettings(db);
}

export interface PromotionListRow extends PromotionRow {
  participants: number;
  pendingCount: number;
  pendingMinor: number;
  creditedMinor: number;
}

export async function listPromotionsWithStats(db: Queryable = getPool()): Promise<PromotionListRow[]> {
  const promos = await listPromotions(db);
  const stats = await db.query(
    `SELECT p.id::text AS id,
            (SELECT count(*)::int FROM promo_participations pp WHERE pp.promotion_id = p.id) +
            (SELECT count(*)::int FROM contest_entries ce WHERE ce.promotion_id = p.id
               AND ce.status IN ('active', 'pending_reset')) AS participants,
            COALESCE(sum(r.amount_minor) FILTER (WHERE r.status = 'pending'), 0)::bigint AS pending_minor,
            count(r.id) FILTER (WHERE r.status = 'pending')::int AS pending_count,
            COALESCE(sum(r.amount_minor) FILTER (WHERE r.status = 'credited'), 0)::bigint AS credited_minor
       FROM promotions p LEFT JOIN promo_rewards r ON r.promotion_id = p.id
      GROUP BY p.id`,
  );
  const by = new Map(stats.rows.map((r) => [String(r.id), r]));
  return promos.map((p) => {
    const s = by.get(p.id);
    return {
      ...p,
      participants: Number(s?.participants ?? 0),
      pendingCount: Number(s?.pending_count ?? 0),
      pendingMinor: Number(s?.pending_minor ?? 0),
      creditedMinor: Number(s?.credited_minor ?? 0),
    };
  });
}

export async function getPromotion(id: string, db: Queryable = getPool()): Promise<PromotionRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return readPromotion(db, id);
}

export interface ParticipantRow {
  id: string;
  userId: string;
  clientName: string;
  clientEmail: string;
  status: string;
  enrolledAt: string;
  evaluatedAt: string | null;
  progress: Record<string, unknown>;
}

export async function listParticipants(promotionId: string, db: Queryable = getPool()): Promise<ParticipantRow[]> {
  const r = await db.query(
    `SELECT pp.id::text AS id, pp.user_id::text AS user_id, u.full_name, u.email, pp.status, pp.enrolled_at,
            pp.evaluated_at, pp.progress
       FROM promo_participations pp JOIN users u ON u.id = pp.user_id
      WHERE pp.promotion_id::text = $1
      ORDER BY pp.enrolled_at DESC
      LIMIT 500`,
    [promotionId],
  );
  return r.rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    clientName: String(row.full_name),
    clientEmail: String(row.email),
    status: String(row.status),
    enrolledAt: iso(row.enrolled_at),
    evaluatedAt: isoOrNull(row.evaluated_at),
    progress: (row.progress ?? {}) as Record<string, unknown>,
  }));
}

export interface RewardRow {
  id: string;
  kind: string;
  promotionId: string | null;
  promotionTitle: string | null;
  promotionSlug: string | null;
  ibPartnerId: string | null;
  ibPartnerName: string | null;
  userId: string;
  clientName: string;
  clientEmail: string;
  relatedUserId: string | null;
  relatedName: string | null;
  relatedEmail: string | null;
  amountMinor: number;
  period: string | null;
  externalRef: string;
  basis: Record<string, unknown>;
  signals: LinkSignal[];
  status: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  rejectReason: string | null;
  checkNote: string | null;
  terminalSeq: number | null;
  creditedAt: string | null;
  createdAt: string;
  budgetMinor: number | null;
  spentMinor: number | null;
}

const REWARD_SQL = `SELECT r.id::text AS id, r.kind, r.promotion_id::text AS promotion_id, p.title AS promotion_title,
       p.slug AS promotion_slug, p.budget_minor, p.spent_minor,
       r.ib_partner_id::text AS ib_partner_id, ib.display_name AS ib_name,
       r.user_id::text AS user_id, u.full_name, u.email,
       r.related_user_id::text AS related_user_id, ru.full_name AS related_name, ru.email AS related_email,
       r.amount_minor, r.period, r.external_ref, r.basis, r.signals, r.status,
       o.display_name AS decided_by, r.decided_at, r.decision_reason, r.reject_reason, r.check_note,
       r.terminal_seq, r.credited_at, r.created_at
  FROM promo_rewards r
  JOIN users u ON u.id = r.user_id
  LEFT JOIN users ru ON ru.id = r.related_user_id
  LEFT JOIN promotions p ON p.id = r.promotion_id
  LEFT JOIN ib_partners ib ON ib.id = r.ib_partner_id
  LEFT JOIN operators o ON o.id = r.decided_by`;

function mapReward(row: Record<string, unknown>): RewardRow {
  return {
    id: String(row.id),
    kind: String(row.kind),
    promotionId: strOrNull(row.promotion_id),
    promotionTitle: strOrNull(row.promotion_title),
    promotionSlug: strOrNull(row.promotion_slug),
    ibPartnerId: strOrNull(row.ib_partner_id),
    ibPartnerName: strOrNull(row.ib_name),
    userId: String(row.user_id),
    clientName: String(row.full_name),
    clientEmail: String(row.email),
    relatedUserId: strOrNull(row.related_user_id),
    relatedName: strOrNull(row.related_name),
    relatedEmail: strOrNull(row.related_email),
    amountMinor: Number(row.amount_minor),
    period: strOrNull(row.period),
    externalRef: String(row.external_ref),
    basis: (row.basis ?? {}) as Record<string, unknown>,
    signals: parseSignals(row.signals),
    status: String(row.status),
    decidedBy: strOrNull(row.decided_by),
    decidedAt: isoOrNull(row.decided_at),
    decisionReason: strOrNull(row.decision_reason),
    rejectReason: strOrNull(row.reject_reason),
    checkNote: strOrNull(row.check_note),
    terminalSeq: row.terminal_seq === null || row.terminal_seq === undefined ? null : Number(row.terminal_seq),
    creditedAt: isoOrNull(row.credited_at),
    createdAt: iso(row.created_at),
    budgetMinor: row.budget_minor === null || row.budget_minor === undefined ? null : Number(row.budget_minor),
    spentMinor: row.spent_minor === null || row.spent_minor === undefined ? null : Number(row.spent_minor),
  };
}

/** Очередь: открытые (ждут решения / зачисляются / отказ терминала) — старейшие сверху; закрытые — новые сверху. */
export async function listRewards(
  filter: { status?: 'open' | 'closed' | 'all'; promotionId?: string } = {},
  db: Queryable = getPool(),
): Promise<RewardRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.promotionId) {
    params.push(filter.promotionId);
    where.push(`r.promotion_id::text = $${params.length}`);
  }
  if (filter.status === 'open') where.push(`r.status IN ('pending', 'approved', 'needs_review')`);
  if (filter.status === 'closed') where.push(`r.status IN ('credited', 'rejected')`);
  const r = await db.query(
    `${REWARD_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE WHEN r.status IN ('pending', 'approved', 'needs_review') THEN 0 ELSE 1 END,
               CASE WHEN r.status IN ('pending', 'approved', 'needs_review') THEN r.created_at END ASC,
               r.created_at DESC
      LIMIT 500`,
    params,
  );
  return r.rows.map(mapReward);
}

export async function getReward(id: string, db: Queryable = getPool()): Promise<RewardRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await db.query(`${REWARD_SQL} WHERE r.id::text = $1`, [id]);
  return r.rows[0] ? mapReward(r.rows[0]) : null;
}

/** Имена клиентов из сигналов (для ссылок на связанных). */
export async function namesOf(ids: string[], db: Queryable = getPool()): Promise<Map<string, { name: string; email: string }>> {
  const out = new Map<string, { name: string; email: string }>();
  if (ids.length === 0) return out;
  const r = await db.query(`SELECT id::text AS id, full_name, email FROM users WHERE id::text = ANY($1::text[])`, [ids]);
  for (const row of r.rows) out.set(String(row.id), { name: String(row.full_name), email: String(row.email) });
  return out;
}

export async function queueCounts(db: Queryable = getPool()): Promise<{ pending: number; pendingMinor: number; review: number; oldest: string | null }> {
  const r = await db.query(
    `SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending,
            COALESCE(sum(amount_minor) FILTER (WHERE status = 'pending'), 0)::bigint AS pending_minor,
            count(*) FILTER (WHERE status IN ('needs_review', 'approved'))::int AS review,
            min(created_at) FILTER (WHERE status = 'pending') AS oldest
       FROM promo_rewards`,
  );
  const row = r.rows[0] ?? {};
  return {
    pending: Number(row.pending ?? 0),
    pendingMinor: Number(row.pending_minor ?? 0),
    review: Number(row.review ?? 0),
    oldest: isoOrNull(row.oldest),
  };
}

export interface AttributionRow {
  refereeId: string;
  refereeName: string;
  refereeEmail: string;
  referrerId: string | null;
  referrerName: string | null;
  referrerEmail: string | null;
  ibPartnerName: string | null;
  code: string | null;
  promoSlug: string | null;
  source: string;
  status: string;
  rejectReason: string | null;
  firstClickAt: string | null;
  attributedAt: string;
  ip: string | null;
  refereeCountry: string | null;
}

export async function listAttributions(db: Queryable = getPool()): Promise<AttributionRow[]> {
  const r = await db.query(
    `SELECT ra.referee_user_id::text AS referee_id, e.full_name AS referee_name, e.email AS referee_email, e.country,
            ra.referrer_user_id::text AS referrer_id, f.full_name AS referrer_name, f.email AS referrer_email,
            ib.display_name AS ib_name, ra.code, ra.promo_slug, ra.source, ra.status, ra.reject_reason,
            ra.first_click_at, ra.attributed_at, ra.ip
       FROM referral_attributions ra
       JOIN users e ON e.id = ra.referee_user_id
       LEFT JOIN users f ON f.id = ra.referrer_user_id
       LEFT JOIN ib_partners ib ON ib.id = ra.ib_partner_id
      ORDER BY ra.attributed_at DESC
      LIMIT 500`,
  );
  return r.rows.map((row) => ({
    refereeId: String(row.referee_id),
    refereeName: String(row.referee_name),
    refereeEmail: String(row.referee_email),
    referrerId: strOrNull(row.referrer_id),
    referrerName: strOrNull(row.referrer_name),
    referrerEmail: strOrNull(row.referrer_email),
    ibPartnerName: strOrNull(row.ib_name),
    code: strOrNull(row.code),
    promoSlug: strOrNull(row.promo_slug),
    source: String(row.source),
    status: String(row.status),
    rejectReason: strOrNull(row.reject_reason),
    firstClickAt: isoOrNull(row.first_click_at),
    attributedAt: iso(row.attributed_at),
    ip: strOrNull(row.ip),
    refereeCountry: strOrNull(row.country),
  }));
}

/** Топ рефереров: кто сколько привёл. */
export async function referrerTotals(db: Queryable = getPool()): Promise<{ userId: string; name: string; email: string; invited: number; code: string | null }[]> {
  const r = await db.query(
    `SELECT f.id::text AS id, f.full_name, f.email, count(*)::int AS n, rc.code
       FROM referral_attributions ra JOIN users f ON f.id = ra.referrer_user_id
       LEFT JOIN referral_codes rc ON rc.user_id = f.id
      WHERE ra.status = 'active'
      GROUP BY f.id, f.full_name, f.email, rc.code
      ORDER BY n DESC LIMIT 10`,
  );
  return r.rows.map((row) => ({
    userId: String(row.id),
    name: String(row.full_name),
    email: String(row.email),
    invited: Number(row.n),
    code: strOrNull(row.code),
  }));
}

export interface PartnerRow {
  id: string;
  userId: string;
  clientName: string;
  clientEmail: string;
  displayName: string;
  model: 'cpa' | 'revshare';
  cpaAmountMinor: number | null;
  cpaRules: Record<string, unknown>;
  revshareBps: number | null;
  status: 'active' | 'paused';
  code: string | null;
  clients: number;
  paidMinor: number;
  pendingMinor: number;
  createdAt: string;
}

export async function listPartners(db: Queryable = getPool()): Promise<PartnerRow[]> {
  const r = await db.query(
    `SELECT p.id::text AS id, p.user_id::text AS user_id, u.full_name, u.email, p.display_name, p.model,
            p.cpa_amount_minor, p.cpa_rules, p.revshare_bps, p.status, rc.code, p.created_at,
            (SELECT count(*)::int FROM referral_attributions ra WHERE ra.ib_partner_id = p.id AND ra.status = 'active') AS clients,
            (SELECT COALESCE(sum(amount_minor), 0)::bigint FROM promo_rewards r WHERE r.ib_partner_id = p.id AND r.status = 'credited') AS paid,
            (SELECT COALESCE(sum(amount_minor), 0)::bigint FROM promo_rewards r WHERE r.ib_partner_id = p.id AND r.status IN ('pending', 'approved', 'needs_review')) AS pending
       FROM ib_partners p JOIN users u ON u.id = p.user_id
       LEFT JOIN referral_codes rc ON rc.user_id = p.user_id
      ORDER BY p.created_at DESC`,
  );
  return r.rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    clientName: String(row.full_name),
    clientEmail: String(row.email),
    displayName: String(row.display_name),
    model: row.model as 'cpa' | 'revshare',
    cpaAmountMinor: row.cpa_amount_minor === null ? null : Number(row.cpa_amount_minor),
    cpaRules: (row.cpa_rules ?? {}) as Record<string, unknown>,
    revshareBps: row.revshare_bps === null ? null : Number(row.revshare_bps),
    status: row.status as 'active' | 'paused',
    code: strOrNull(row.code),
    clients: Number(row.clients),
    paidMinor: Number(row.paid),
    pendingMinor: Number(row.pending),
    createdAt: iso(row.created_at),
  }));
}

export async function finalSnapshot(promotionId: string, db: Queryable = getPool()): Promise<{ takenAt: string; standings: unknown } | null> {
  const r = await db.query(
    `SELECT taken_at, standings FROM contest_snapshots WHERE promotion_id::text = $1 AND is_final`,
    [promotionId],
  );
  return r.rows[0] ? { takenAt: iso(r.rows[0].taken_at), standings: r.rows[0].standings } : null;
}

export async function contestEntryCounts(promotionId: string, db: Queryable = getPool()): Promise<Record<string, number>> {
  const r = await db.query(
    `SELECT status, count(*)::int AS n FROM contest_entries WHERE promotion_id::text = $1 GROUP BY status`,
    [promotionId],
  );
  return Object.fromEntries(r.rows.map((row) => [String(row.status), Number(row.n)]));
}
