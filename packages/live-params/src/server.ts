import type { Queryable } from '@broker/money';
import { isShowcasePromotion, mapPromotion, PROMOS_OFF, PROMOTION_COLUMNS, type PlatformPromoSettings } from '@broker/promo';
import { parseSupportSettings } from '@broker/support';
import {
  parseMoney,
  parsePortfolio,
  type LivePortfolio,
  type LivePromotion,
  type LiveSnapshot,
  type LiveSupportHours,
} from './snapshot';

export const LIVE_SNAPSHOT_SQL = `
SELECT
  (SELECT row_to_json(m) FROM (
     SELECT min_deposit_minor, min_withdraw_minor, unverified_withdraw_bps
       FROM platform_money_settings WHERE id = 1) m) AS money,
  (SELECT COALESCE(json_agg(p ORDER BY p.sort_order, p.key), '[]'::json) FROM (
     SELECT lp.key, lp.title, lp.base_leverage, lp.is_default, lp.is_public, lp.sort_order,
            lp.markup_bps, lp.commission_bps, lp.instruments, lp.description,
            (SELECT COALESCE(json_object_agg(o.instrument_class, o.leverage), '{}'::json)
               FROM leverage_portfolio_class_overrides o WHERE o.portfolio_key = lp.key) AS class_overrides
       FROM leverage_portfolios lp
      WHERE lp.is_public OR lp.is_default) p) AS portfolios,
  (SELECT settings FROM support_settings WHERE id = 1) AS support,
  (SELECT row_to_json(s) FROM (
     SELECT promotions_enabled, attribution_window_days, blocked_countries
       FROM platform_promo_settings WHERE id = 1) s) AS promo_settings,
  (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
     SELECT ${PROMOTION_COLUMNS} FROM promotions WHERE status = 'active' ORDER BY created_at DESC) x) AS promotions
`;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const json = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

function readMoney(raw: unknown) {
  const r = json(raw);
  if (!isObj(r)) return null;
  return parseMoney({
    minDepositMinor: Number(r.min_deposit_minor),
    minWithdrawMinor: Number(r.min_withdraw_minor),
    unverifiedWithdrawBps: Number(r.unverified_withdraw_bps),
  });
}

function readPortfolios(raw: unknown): LivePortfolio[] {
  const list = json(raw);
  if (!Array.isArray(list)) return [];
  return list
    .map((r) =>
      isObj(r)
        ? parsePortfolio({
            key: r.key,
            title: r.title,
            baseLeverage: Number(r.base_leverage),
            classOverrides: json(r.class_overrides),
            markupBps: Number(r.markup_bps),
            commissionBps: Number(r.commission_bps),
            isDefault: r.is_default === true,
            isPublic: r.is_public === true,
            sortOrder: Number(r.sort_order),
            instruments: r.instruments,
            description: r.description,
          })
        : null,
    )
    .filter((p): p is LivePortfolio => p !== null);
}

function readSupport(raw: unknown): LiveSupportHours | null {
  const r = json(raw);
  if (!isObj(r)) return null;
  const { hours } = parseSupportSettings(r);
  const week: LiveSupportHours['week'] = {};
  for (const [day, h] of Object.entries(hours.week)) if (h) week[day as keyof typeof week] = { open: h.open, close: h.close };
  return { alwaysOpen: hours.alwaysOpen, timezone: hours.timezone, week };
}

function readPromoSettings(raw: unknown): PlatformPromoSettings | null {
  const r = json(raw);
  if (!isObj(r)) return null;
  return {
    promotionsEnabled: r.promotions_enabled === true,
    attributionWindowDays: Number(r.attribution_window_days),
    blockedCountries: Array.isArray(r.blocked_countries) ? r.blocked_countries.map((c) => String(c).toUpperCase()) : [],
  };
}

function readPromotions(raw: unknown, settings: PlatformPromoSettings, now: Date): LivePromotion[] {
  const list = json(raw);
  if (!Array.isArray(list)) return [];
  const out: LivePromotion[] = [];
  for (const row of list) {
    if (!isObj(row)) continue;
    const promo = mapPromotion(row);
    if (!isShowcasePromotion(promo, settings, null, now)) continue;
    out.push({
      id: promo.id,
      slug: promo.slug,
      type: promo.type,
      cmsPromoId: promo.cmsPromoId,
      startsAt: promo.startsAt,
      endsAt: promo.endsAt,
      texts: Object.fromEntries(
        Object.entries(promo.texts).map(([locale, t]) => [locale, { title: t.title, summary: t.summary ?? '', terms: t.terms ?? '' }]),
      ),
    });
  }
  return out;
}

export async function readLiveSnapshot(db: Queryable, now: Date = new Date()): Promise<LiveSnapshot> {
  const r = await db.query(LIVE_SNAPSHOT_SQL);
  const row = r.rows[0] ?? {};
  const promoSettings = readPromoSettings(row.promo_settings);
  return {
    money: readMoney(row.money),
    portfolios: readPortfolios(row.portfolios),
    support: readSupport(row.support),
    promo: promoSettings
      ? { enabled: promoSettings.promotionsEnabled, attributionWindowDays: promoSettings.attributionWindowDays }
      : null,
    promotions: readPromotions(row.promotions, promoSettings ?? PROMOS_OFF, now),
  };
}
