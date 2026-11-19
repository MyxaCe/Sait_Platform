export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface LiveMoney {
  minDepositMinor: number;
  minWithdrawMinor: number;
  unverifiedWithdrawBps: number;
}

export interface LivePortfolio {
  key: string;
  title: string;
  baseLeverage: number;
  classOverrides: Record<string, number>;
  markupBps: number;
  commissionBps: number;
  isDefault: boolean;
  isPublic: boolean;
  sortOrder: number;
  instruments: string | null;
  description: string | null;
}

export interface LiveDayHours {
  open: string;
  close: string;
}

export interface LiveSupportHours {
  alwaysOpen: boolean;
  timezone: string;
  week: Partial<Record<Weekday, LiveDayHours>>;
}

export interface LivePromotionText {
  title: string;
  summary: string;
  terms: string;
}

export interface LivePromotion {
  id: string;
  slug: string;
  type: string;
  cmsPromoId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  texts: Record<string, LivePromotionText>;
}

export interface LivePromoSettings {
  enabled: boolean;
  attributionWindowDays: number;
}

export interface LiveSnapshot {
  money: LiveMoney | null;
  portfolios: LivePortfolio[] | null;
  support: LiveSupportHours | null;
  promo: LivePromoSettings | null;
  promotions: LivePromotion[] | null;
}

export const EMPTY_SNAPSHOT: LiveSnapshot = Object.freeze({
  money: null,
  portfolios: null,
  support: null,
  promo: null,
  promotions: null,
});

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown, min = 0): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= min ? n : null;
};
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseMoney(raw: unknown): LiveMoney | null {
  if (!isObj(raw)) return null;
  const minDepositMinor = int(raw.minDepositMinor);
  const minWithdrawMinor = int(raw.minWithdrawMinor);
  const unverifiedWithdrawBps = int(raw.unverifiedWithdrawBps);
  if (minDepositMinor === null || minWithdrawMinor === null || unverifiedWithdrawBps === null) return null;
  if (unverifiedWithdrawBps > 10_000) return null;
  return { minDepositMinor, minWithdrawMinor, unverifiedWithdrawBps };
}

export function parsePortfolio(raw: unknown): LivePortfolio | null {
  if (!isObj(raw)) return null;
  const key = text(raw.key);
  const title = text(raw.title);
  const baseLeverage = int(raw.baseLeverage, 1);
  const markupBps = int(raw.markupBps);
  const commissionBps = int(raw.commissionBps);
  if (!key || !title || baseLeverage === null || markupBps === null || commissionBps === null) return null;
  const classOverrides: Record<string, number> = {};
  if (isObj(raw.classOverrides)) {
    for (const [cls, value] of Object.entries(raw.classOverrides)) {
      const n = int(value, 1);
      if (n !== null && cls.trim()) classOverrides[cls.trim()] = n;
    }
  }
  return {
    key,
    title,
    baseLeverage,
    classOverrides,
    markupBps,
    commissionBps,
    isDefault: raw.isDefault === true,
    isPublic: raw.isPublic !== false,
    sortOrder: int(raw.sortOrder, Number.MIN_SAFE_INTEGER) ?? 0,
    instruments: text(raw.instruments),
    description: text(raw.description),
  };
}

export function parseSupportHours(raw: unknown): LiveSupportHours | null {
  if (!isObj(raw) || typeof raw.alwaysOpen !== 'boolean') return null;
  const timezone = text(raw.timezone);
  if (!timezone) return null;
  const week: Partial<Record<Weekday, LiveDayHours>> = {};
  if (isObj(raw.week)) {
    for (const day of WEEKDAYS) {
      const h = raw.week[day];
      if (isObj(h) && typeof h.open === 'string' && typeof h.close === 'string' && HHMM.test(h.open) && HHMM.test(h.close)) {
        week[day] = { open: h.open, close: h.close };
      }
    }
  }
  return { alwaysOpen: raw.alwaysOpen, timezone, week };
}

function parsePromotionText(raw: unknown): LivePromotionText | null {
  if (!isObj(raw)) return null;
  const title = text(raw.title);
  if (!title) return null;
  return {
    title,
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    terms: typeof raw.terms === 'string' ? raw.terms : '',
  };
}

export function parsePromotion(raw: unknown): LivePromotion | null {
  if (!isObj(raw)) return null;
  const id = text(raw.id);
  const slug = text(raw.slug);
  const type = text(raw.type);
  if (!id || !slug || !type) return null;
  const texts: Record<string, LivePromotionText> = {};
  if (isObj(raw.texts)) {
    for (const [locale, value] of Object.entries(raw.texts)) {
      const t = parsePromotionText(value);
      if (t) texts[locale] = t;
    }
  }
  return {
    id,
    slug,
    type,
    cmsPromoId: text(raw.cmsPromoId),
    startsAt: text(raw.startsAt),
    endsAt: text(raw.endsAt),
    texts,
  };
}

function parsePromoSettings(raw: unknown): LivePromoSettings | null {
  if (!isObj(raw) || typeof raw.enabled !== 'boolean') return null;
  const attributionWindowDays = int(raw.attributionWindowDays, 1);
  if (attributionWindowDays === null) return null;
  return { enabled: raw.enabled, attributionWindowDays };
}

function parseList<T>(raw: unknown, parse: (v: unknown) => T | null): T[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map(parse).filter((x): x is T => x !== null);
}

export function parseLiveSnapshot(raw: unknown): LiveSnapshot {
  if (!isObj(raw)) return EMPTY_SNAPSHOT;
  return {
    money: parseMoney(raw.money),
    portfolios: parseList(raw.portfolios, parsePortfolio),
    support: parseSupportHours(raw.support),
    promo: parsePromoSettings(raw.promo),
    promotions: parseList(raw.promotions, parsePromotion),
  };
}

export function publicPortfolios(snapshot: LiveSnapshot | null): LivePortfolio[] | null {
  if (!snapshot?.portfolios) return null;
  return snapshot.portfolios
    .filter((p) => p.isPublic)
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export function defaultPortfolio(snapshot: LiveSnapshot | null): LivePortfolio | null {
  return snapshot?.portfolios?.find((p) => p.isDefault) ?? null;
}

export function portfolioLeverage(portfolio: LivePortfolio, instrumentClass: string | null): number {
  if (instrumentClass && Object.prototype.hasOwnProperty.call(portfolio.classOverrides, instrumentClass)) {
    return portfolio.classOverrides[instrumentClass]!;
  }
  return portfolio.baseLeverage;
}
