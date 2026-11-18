import { readAccess, UNAVAILABLE, type TenantAccess, type TenantAccessUnavailableReason } from './access';
import {
  readStartBalance,
  START_BALANCE_UNAVAILABLE,
  type TenantStartBalance,
  type TenantStartBalanceUnavailableReason,
} from './balance';
import {
  applyListExpiry,
  readConfigExpiry,
  readListExpiry,
  type TenantListExpiry,
} from './expiry';

export interface TenantConfig {
  readonly access: TenantAccess;
  readonly startBalance: TenantStartBalance;
  readonly expiry: TenantListExpiry;
}

export interface TenantConfigRequest {
  readonly baseUrl: string | undefined;
  readonly slug: string | null;
  readonly apiKey?: string | undefined;
  readonly fetchInit?: RequestInit;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly onUnavailable?: (reason: TenantAccessUnavailableReason, detail: unknown) => void;
}

function defaultReport(reason: TenantAccessUnavailableReason, detail: unknown): void {
  console.error(
    `[tenant] конфиг тенанта недоступен (${reason}) — граница закрыта fail-closed`,
    detail,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function both(
  reason: TenantStartBalanceUnavailableReason,
): { access: TenantAccess; startBalance: TenantStartBalance } {
  return { access: UNAVAILABLE[reason], startBalance: START_BALANCE_UNAVAILABLE[reason] };
}

export async function fetchTenantConfig(request: TenantConfigRequest): Promise<TenantConfig> {
  const {
    slug,
    apiKey,
    fetchInit,
    timeoutMs = 3_000,
    now = Date.now,
    onUnavailable = defaultReport,
  } = request;
  const base = request.baseUrl?.replace(/\/$/, '');
  const unnamed: TenantListExpiry = { state: 'unnamed' };

  if (!base) return { ...both('not-configured'), expiry: unnamed };
  if (slug === null) return { ...both('not-configured'), expiry: unnamed };

  try {
    const res = await fetch(`${base}/cms/sites/${slug}`, {
      ...fetchInit,
      headers: apiKey ? { 'X-API-Key': apiKey } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      onUnavailable('http-error', { slug, status: res.status });
      return { ...both('http-error'), expiry: unnamed };
    }
    const data = (await res.json()) as {
      instruments?: unknown;
      demoStartBalanceCents?: unknown;
      settings?: unknown;
    };

    const fromConfig = readConfigExpiry((data as { settings?: unknown }).settings);
    const expiry = fromConfig.state === 'unnamed' ? readListExpiry(res.headers) : fromConfig;
    const parsed = readAccess(data.instruments);
    if (parsed.state === 'unavailable') onUnavailable(parsed.reason, { slug, got: typeof data.instruments });

    const access = applyListExpiry(parsed, expiry, now());
    if (access.state === 'unavailable' && access.reason === 'expired') {
      onUnavailable('expired', { slug, expiresAt: expiry.state === 'named' ? expiry.expiresAt : null });
    }
    if (access.state === 'unavailable' && access.reason === 'expiry-malformed') {
      onUnavailable('expiry-malformed', {
        slug,
        got: isRecord(data.settings) ? typeof data.settings['instrumentsExpiresAt'] : 'no-settings',
      });
    }

    return { access, startBalance: readStartBalance(data.demoStartBalanceCents), expiry };
  } catch (error) {
    onUnavailable('network', { slug, error: (error as Error)?.message });
    return { ...both('network'), expiry: unnamed };
  }
}
