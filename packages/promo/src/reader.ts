import type { Queryable } from '@broker/money';
import { computeLinkSignals, isMeaningfulIp, type Fingerprint, type LinkSignal } from './antifraud';
import type { PlatformPromoSettings } from './eligibility';
import type { ClientFacts, DepositFact, TradeFact, WithdrawalFact } from './facts';
import { parseRules, parseTexts, type ParsedRules, type PromoTexts, type PromotionType } from './rules';

/**
 * ЧИТАТЕЛИ — один SQL на один род фактов. Движок над ними — чистый.
 */

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/* ── Настройки ────────────────────────────────────────────────────────── */

/**
 * Настройки акций платформы. Строки нет (миграция ещё не накатана на эту
 * базу) — акции ВЫКЛЮЧЕНЫ: fail-closed для комплаенса, а срок атрибуции —
 * `null` (не выдумываем число).
 */
export async function readPromoSettings(db: Queryable): Promise<PlatformPromoSettings | null> {
  const r = await db.query(
    `SELECT promotions_enabled, attribution_window_days, blocked_countries
       FROM platform_promo_settings WHERE id = 1`,
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    promotionsEnabled: row.promotions_enabled === true,
    attributionWindowDays: num(row.attribution_window_days),
    blockedCountries: strArr(row.blocked_countries).map((c) => c.toUpperCase()),
  };
}

export const PROMOS_OFF: PlatformPromoSettings = {
  promotionsEnabled: false,
  attributionWindowDays: 1,
  blockedCountries: [],
};

/* ── Акции ────────────────────────────────────────────────────────────── */

export interface PromotionRow {
  id: string;
  slug: string;
  type: PromotionType;
  title: string;
  cmsPromoId: string | null;
  status: string;
  rulesRaw: unknown;
  /** Разобранные правила; `null` — правила испорчены (показать оператору). */
  parsed: ParsedRules | null;
  ruleIssues: string[];
  texts: PromoTexts;
  startsAt: string | null;
  endsAt: string | null;
  budgetMinor: number;
  spentMinor: number;
  countriesAllow: string[];
  countriesDeny: string[];
  createdAt: string;
  updatedAt: string;
}

export const PROMOTION_COLUMNS = `id::text AS id, slug, type, title, cms_promo_id, status, rules, texts,
  starts_at, ends_at, budget_minor, spent_minor, countries_allow, countries_deny, created_at, updated_at`;

export function mapPromotion(row: Record<string, unknown>): PromotionRow {
  const parsed = parseRules(String(row.type), row.rules);
  return {
    id: String(row.id),
    slug: String(row.slug),
    type: String(row.type) as PromotionType,
    title: String(row.title),
    cmsPromoId: row.cms_promo_id === null || row.cms_promo_id === undefined ? null : String(row.cms_promo_id),
    status: String(row.status),
    rulesRaw: row.rules,
    parsed: parsed.ok ? parsed.value : null,
    ruleIssues: parsed.ok ? [] : parsed.issues,
    texts: parseTexts(row.texts),
    startsAt: isoOrNull(row.starts_at),
    endsAt: isoOrNull(row.ends_at),
    budgetMinor: num(row.budget_minor),
    spentMinor: num(row.spent_minor),
    countriesAllow: strArr(row.countries_allow),
    countriesDeny: strArr(row.countries_deny),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function readPromotion(db: Queryable, id: string, forUpdate = false): Promise<PromotionRow | null> {
  const r = await db.query(
    `SELECT ${PROMOTION_COLUMNS} FROM promotions WHERE id::text = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  );
  return r.rows[0] ? mapPromotion(r.rows[0]) : null;
}

export async function listPromotions(db: Queryable, filter: { type?: PromotionType } = {}): Promise<PromotionRow[]> {
  const r = filter.type
    ? await db.query(`SELECT ${PROMOTION_COLUMNS} FROM promotions WHERE type = $1 ORDER BY created_at DESC`, [filter.type])
    : await db.query(`SELECT ${PROMOTION_COLUMNS} FROM promotions ORDER BY created_at DESC`);
  return r.rows.map(mapPromotion);
}

/* ── Факты клиента ───────────────────────────────────────────────────── */

export async function readClientFacts(
  db: Queryable,
  userId: string,
  opts: { tradesFrom?: string | null } = {},
): Promise<ClientFacts | null> {
  const u = await db.query(
    `SELECT u.id::text AS id, u.created_at, u.country, cv.state AS kyc_state
       FROM users u LEFT JOIN client_verification cv ON cv.user_id = u.id
      WHERE u.id::text = $1`,
    [userId],
  );
  const user = u.rows[0];
  if (!user) return null;
  const deposits = await db.query(
    `SELECT id::text AS id, amount_minor, credited_at, from_address
       FROM crypto_deposits
      WHERE user_id::text = $1 AND status = 'credited' AND credited_at IS NOT NULL AND amount_minor IS NOT NULL
      ORDER BY credited_at`,
    [userId],
  );
  const trades = await db.query(
    `SELECT symbol, side, volume, price, executed_at, commission_minor, markup_minor, realized_pnl_cents
       FROM real_trades
      WHERE user_id::text = $1 AND executed_at >= COALESCE($2::timestamptz, '-infinity'::timestamptz)
      ORDER BY executed_at`,
    [userId, opts.tradesFrom ?? null],
  );
  const withdrawals = await db.query(
    `SELECT id::text AS id, requested_at, status FROM crypto_withdrawals WHERE user_id::text = $1`,
    [userId],
  );
  return {
    userId,
    registeredAt: iso(user.created_at),
    kycVerified: user.kyc_state === 'verified',
    country: user.country === null || user.country === undefined ? null : String(user.country),
    deposits: deposits.rows.map(
      (d): DepositFact => ({
        id: String(d.id),
        amountMinor: num(d.amount_minor),
        creditedAt: iso(d.credited_at),
        fromAddress: d.from_address === null ? null : String(d.from_address),
      }),
    ),
    trades: trades.rows.map(mapTrade),
    withdrawals: withdrawals.rows.map(
      (w): WithdrawalFact => ({ id: String(w.id), requestedAt: iso(w.requested_at), status: String(w.status) }),
    ),
  };
}

export function mapTrade(t: Record<string, unknown>): TradeFact {
  return {
    symbol: String(t.symbol),
    side: t.side === 'sell' ? 'sell' : 'buy',
    volume: num(t.volume),
    price: num(t.price),
    executedAt: iso(t.executed_at),
    commissionMinor: numOrNull(t.commission_minor),
    markupMinor: numOrNull(t.markup_minor),
    realizedPnlMinor: numOrNull(t.realized_pnl_cents),
  };
}

/* ── Сигналы связанности ─────────────────────────────────────────────── */

async function fingerprint(db: Queryable, userId: string): Promise<Fingerprint | null> {
  const u = await db.query(
    `SELECT email, country, registration_ip, registration_ip_country FROM users WHERE id::text = $1`,
    [userId],
  );
  const row = u.rows[0];
  if (!row) return null;
  const wallets = await db.query(
    `SELECT DISTINCT from_address FROM crypto_deposits WHERE user_id::text = $1 AND from_address IS NOT NULL`,
    [userId],
  );
  const addrs = await db.query(
    `SELECT DISTINCT to_address FROM crypto_withdrawals WHERE user_id::text = $1`,
    [userId],
  );
  const ips = await db.query(`SELECT DISTINCT ip FROM sessions WHERE user_id::text = $1 AND ip IS NOT NULL`, [userId]);
  const ipList = ips.rows.map((r) => String(r.ip));
  if (row.registration_ip) ipList.push(String(row.registration_ip));
  return {
    userId,
    email: row.email === null ? null : String(row.email),
    country: row.country === null ? null : String(row.country),
    registrationIpCountry: row.registration_ip_country === null ? null : String(row.registration_ip_country),
    depositWallets: wallets.rows.map((r) => String(r.from_address)),
    withdrawAddresses: addrs.rows.map((r) => String(r.to_address)),
    ips: [...new Set(ipList)].filter(isMeaningfulIp),
  };
}

/**
 * Сигналы для получателя начисления: клиенты с общим кошельком-отправителем,
 * адресом вывода или IP + связь со вторым участником пары (самореферал).
 */
export async function readLinkSignals(
  db: Queryable,
  userId: string,
  counterpartUserId: string | null = null,
): Promise<LinkSignal[]> {
  const target = await fingerprint(db, userId);
  if (!target) return [];
  const others = new Map<string, { depositWallets: string[]; withdrawAddresses: string[]; ips: string[] }>();
  const bucket = (id: string) => {
    let b = others.get(id);
    if (!b) {
      b = { depositWallets: [], withdrawAddresses: [], ips: [] };
      others.set(id, b);
    }
    return b;
  };
  if (target.depositWallets.length > 0) {
    const r = await db.query(
      `SELECT DISTINCT user_id::text AS user_id, from_address FROM crypto_deposits
        WHERE from_address = ANY($1::text[]) AND user_id IS NOT NULL AND user_id::text <> $2`,
      [target.depositWallets, userId],
    );
    for (const row of r.rows) bucket(String(row.user_id)).depositWallets.push(String(row.from_address));
  }
  if (target.withdrawAddresses.length > 0) {
    const r = await db.query(
      `SELECT DISTINCT user_id::text AS user_id, to_address FROM crypto_withdrawals
        WHERE to_address = ANY($1::text[]) AND user_id::text <> $2`,
      [target.withdrawAddresses, userId],
    );
    for (const row of r.rows) bucket(String(row.user_id)).withdrawAddresses.push(String(row.to_address));
  }
  if (target.ips.length > 0) {
    const r = await db.query(
      `SELECT DISTINCT user_id::text AS user_id, ip FROM sessions WHERE ip = ANY($1::text[]) AND user_id::text <> $2
       UNION
       SELECT id::text AS user_id, registration_ip AS ip FROM users
        WHERE registration_ip = ANY($1::text[]) AND id::text <> $2`,
      [target.ips, userId],
    );
    for (const row of r.rows) bucket(String(row.user_id)).ips.push(String(row.ip));
  }
  const list: Fingerprint[] = [...others.entries()].map(([id, b]) => ({ userId: id, ...b }));
  if (counterpartUserId && counterpartUserId !== userId) {
    const cp = await fingerprint(db, counterpartUserId);
    if (cp) {
      const shared = list.find((f) => f.userId === counterpartUserId);
      // Email и прочее берём из полного отпечатка, общие значения — из поиска.
      if (shared) Object.assign(shared, { email: cp.email });
      else list.push({ userId: counterpartUserId, email: cp.email, depositWallets: [], withdrawAddresses: [], ips: [] });
    }
  }
  return computeLinkSignals(target, list, { counterpartUserId });
}
