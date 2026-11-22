export const ATTRIBUTION_COOKIES = { ref: 'bp_ref', promo: 'bp_promo' } as const;

const REF_RE = /^[A-Za-z0-9]{4,32}$/;
const PROMO_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

export interface ClickValue {
  value: string;
  at: Date;
}

export function normalizeRefCode(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  return REF_RE.test(v) ? v.toUpperCase() : null;
}

export function normalizePromoSlug(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase();
  return PROMO_RE.test(v) ? v : null;
}

export function encodeClick(value: string, at: Date): string {
  return `${value}.${Math.floor(at.getTime() / 1000)}`;
}

export function decodeClick(raw: string | null | undefined, kind: 'ref' | 'promo'): ClickValue | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const value = kind === 'ref' ? normalizeRefCode(raw.slice(0, dot)) : normalizePromoSlug(raw.slice(0, dot));
  const sec = Number(raw.slice(dot + 1));
  if (!value || !Number.isInteger(sec) || sec <= 0) return null;
  return { value, at: new Date(sec * 1000) };
}

export function withinWindow(click: ClickValue, now: Date, windowDays: number | null): boolean {
  if (click.at.getTime() > now.getTime() + 5 * 60_000) return false;
  if (windowDays === null) return true;
  return now.getTime() - click.at.getTime() <= windowDays * 86_400_000;
}

export interface CookieToSet {
  name: string;
  value: string;
  maxAge: number | null;
}

export function cookiesForClick(input: {
  params: { ref?: string | null; promo?: string | null };
  existing: { ref?: string | null; promo?: string | null };
  now: Date;
  windowDays: number | null;
}): CookieToSet[] {
  const out: CookieToSet[] = [];
  const maxAge = input.windowDays === null ? null : input.windowDays * 86_400;
  const ref = normalizeRefCode(input.params.ref);
  if (ref) {
    const cur = decodeClick(input.existing.ref, 'ref');
    if (!cur || !withinWindow(cur, input.now, input.windowDays)) {
      out.push({ name: ATTRIBUTION_COOKIES.ref, value: encodeClick(ref, input.now), maxAge });
    }
  }
  const promo = normalizePromoSlug(input.params.promo);
  if (promo) {
    const cur = decodeClick(input.existing.promo, 'promo');
    if (!cur || !withinWindow(cur, input.now, input.windowDays)) {
      out.push({ name: ATTRIBUTION_COOKIES.promo, value: encodeClick(promo, input.now), maxAge });
    }
  }
  return out;
}

export interface ResolvedClick {
  value: string;
  firstClickAt: Date;
  source: 'cookie' | 'param';
}

export interface ResolvedAttribution {
  ref: ResolvedClick | null;
  promo: ResolvedClick | null;
}

export function resolveAttribution(input: {
  cookies: { ref?: string | null; promo?: string | null };
  params: { ref?: string | null; promo?: string | null };
  now: Date;
  windowDays: number;
}): ResolvedAttribution {
  function pick(kind: 'ref' | 'promo'): ResolvedClick | null {
    const c = decodeClick(input.cookies[kind], kind);
    if (c && withinWindow(c, input.now, input.windowDays)) {
      return { value: c.value, firstClickAt: c.at, source: 'cookie' };
    }
    const p = kind === 'ref' ? normalizeRefCode(input.params.ref) : normalizePromoSlug(input.params.promo);
    return p ? { value: p, firstClickAt: input.now, source: 'param' } : null;
  }
  return { ref: pick('ref'), promo: pick('promo') };
}
