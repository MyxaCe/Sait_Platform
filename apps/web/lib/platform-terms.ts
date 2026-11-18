import { envOr } from '@broker/utils';

export interface PublicAccountType {
  key: string;
  title: string;
  isDefault: boolean;
  leverage: number;
  baseLeverage: number;
  classOverrides: Record<string, number>;
  markupBps: number;
  commissionBps: number;
  instruments: string | null;
  description: string | null;
}

const TIMEOUT_MS = 1_500;

const int = (v: unknown, min = 0): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min ? v : null;
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function parseAccountType(raw: unknown): PublicAccountType | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const key = text(r.key);
  const title = text(r.title);
  const leverage = int(r.leverage, 1);
  const baseLeverage = int(r.baseLeverage, 1);
  const markupBps = int(r.markupBps);
  const commissionBps = int(r.commissionBps);
  if (!key || !title || leverage === null || baseLeverage === null || markupBps === null || commissionBps === null) {
    return null;
  }
  const classOverrides: Record<string, number> = {};
  if (r.classOverrides && typeof r.classOverrides === 'object') {
    for (const [k, v] of Object.entries(r.classOverrides as Record<string, unknown>)) {
      const n = int(v, 1);
      if (n !== null) classOverrides[k] = n;
    }
  }
  return {
    key,
    title,
    isDefault: r.isDefault === true,
    leverage,
    baseLeverage,
    classOverrides,
    markupBps,
    commissionBps,
    instruments: text(r.instruments),
    description: text(r.description),
  };
}

export function parseAccountTypes(body: unknown): PublicAccountType[] | null {
  const list = (body as { accountTypes?: unknown } | null)?.accountTypes;
  if (!Array.isArray(list)) return null;
  return list.map(parseAccountType).filter((x): x is PublicAccountType => x !== null);
}

export async function fetchAccountTypes(fetchImpl: typeof fetch = fetch): Promise<PublicAccountType[] | null> {
  const base = envOr(process.env.CABINET_INTERNAL_URL, envOr(process.env.NEXT_PUBLIC_CABINET_URL, '')).replace(/\/$/, '');
  if (!base) return null;
  try {
    const res = await fetchImpl(`${base}/api/public/platform-terms`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: 60 },
    } as RequestInit);
    if (!res.ok) return null;
    return parseAccountTypes(await res.json());
  } catch {
    return null;
  }
}

export function bpsPercent(bps: number, locale: string): string {
  const n = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'ru-RU', { maximumFractionDigits: 2 }).format(bps / 100);
  return locale === 'en' ? `${n}%` : `${n} %`;
}
