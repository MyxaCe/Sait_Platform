import { UNAVAILABLE, type TenantAccess } from './access';

export const EDITORIAL_REUSE_WINDOW_SECONDS = 300;

export type TenantListExpiry =
  | {
      readonly state: 'named';
      readonly expiresAt: number;
      readonly source: 'config-field' | 'response-headers';
    }
  | { readonly state: 'unnamed' }
  | { readonly state: 'malformed' };

const UNNAMED: TenantListExpiry = { state: 'unnamed' };
const MALFORMED: TenantListExpiry = { state: 'malformed' };

export interface ExpiryHeaders {
  get(name: string): string | null;
}

function freshnessSeconds(cacheControl: string): number | null {
  for (const directive of ['s-maxage', 'max-age']) {
    const match = new RegExp(`(?:^|,)\\s*${directive}\\s*=\\s*"?(\\d+)"?\\s*(?=,|$)`, 'i').exec(
      cacheControl,
    );
    if (match) {
      const seconds = Number(match[1]);
      return Number.isSafeInteger(seconds) ? seconds : null;
    }
  }
  return null;
}

export function readListExpiry(headers: ExpiryHeaders): TenantListExpiry {
  const originTime = Date.parse(headers.get('date') ?? '');
  const cacheControl = headers.get('cache-control') ?? '';
  const seconds = freshnessSeconds(cacheControl);

  if (seconds !== null && seconds > 0) {
    if (!Number.isFinite(originTime)) return UNNAMED;
    return { state: 'named', expiresAt: originTime + seconds * 1000, source: 'response-headers' };
  }

  const expires = Date.parse(headers.get('expires') ?? '');
  if (Number.isFinite(expires) && (!Number.isFinite(originTime) || expires > originTime)) {
    return { state: 'named', expiresAt: expires, source: 'response-headers' };
  }

  return UNNAMED;
}

const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (lengths[month - 1] as number);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readConfigExpiry(settings: unknown): TenantListExpiry {
  if (!isRecord(settings)) return UNNAMED;

  const raw = settings['instrumentsExpiresAt'];
  if (typeof raw !== 'string') return MALFORMED;

  const shape = ISO_INSTANT.exec(raw);
  if (!shape) return MALFORMED;

  const [, year, month, day, hour, minute, second] = shape.map(Number) as number[];
  if (!isRealCalendarDate(year as number, month as number, day as number)) return MALFORMED;
  if ((hour as number) > 23 || (minute as number) > 59 || (second as number) > 60) return MALFORMED;

  const expiresAt = Date.parse(raw);
  if (!Number.isFinite(expiresAt)) return MALFORMED;

  return { state: 'named', expiresAt, source: 'config-field' };
}

export function applyListExpiry(
  access: TenantAccess,
  expiry: TenantListExpiry,
  nowMs: number,
): TenantAccess {
  if (access.state === 'unavailable') return access;
  if (expiry.state === 'malformed') return UNAVAILABLE['expiry-malformed'];
  if (expiry.state === 'unnamed') return access;
  return nowMs > expiry.expiresAt ? UNAVAILABLE.expired : access;
}
