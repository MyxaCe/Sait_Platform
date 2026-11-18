import {
  parseCabinetHomeModules,
  type CabinetHomeModule,
} from '@broker/api-client';
import { cmsGet } from './chrome';
import { getVerificationState, type VerificationState } from './kyc';
import {
  getTenantConfig,
  isSymbolAllowed,
  type TenantAccessUnavailableReason,
} from './tenant';

export const DEFAULT_MODULES: CabinetHomeModule[] = [
  { type: 'profile', enabled: true },
  { type: 'onboarding', enabled: true, steps: { verification: true, deposit: true, firstTrade: true } },
  { type: 'balance', enabled: true, buttons: { deposit: true, withdraw: true, buyFiat: true } },
  {
    type: 'markets',
    enabled: true,
    tabs: { assets: true, popular: true, newListing: true, favorites: false, gainers: true, volume: false },
    newListingSymbols: [],
  },
  { type: 'promotions', enabled: true },
];

export async function getHomeModules(locale: string): Promise<CabinetHomeModule[]> {
  const data = await cmsGet('cabinet-home', locale);
  if (!data) return DEFAULT_MODULES;
  const modules = parseCabinetHomeModules(data);
  return modules.length > 0 ? modules : DEFAULT_MODULES;
}

export interface MarketInstrument {
  symbol: string;
  name: string;
  digits: number;
  icon: string | null;
}

export type MarketsData =
  | { state: 'ok'; instruments: MarketInstrument[] }
  | { state: 'access-empty' }
  | { state: 'access-unavailable'; reason: TenantAccessUnavailableReason }
  | { state: 'catalog-unavailable'; reason: 'not-configured' | 'http-error' | 'network' };

export async function getMarketInstruments(): Promise<MarketsData> {
  const access = (await getTenantConfig()).access;
  if (access.state === 'empty') return { state: 'access-empty' };
  if (access.state === 'unavailable') {
    return { state: 'access-unavailable', reason: access.reason };
  }

  const url = process.env.MDS_HTTP_URL;
  if (!url) return { state: 'catalog-unavailable', reason: 'not-configured' };
  const iconBase = process.env.NEXT_PUBLIC_WS_URL?.replace(/\/$/, '');
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/v1/instruments`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return { state: 'catalog-unavailable', reason: 'http-error' };
    const data = (await res.json()) as { items?: (MarketInstrument & { icon?: string | null })[] };
    return {
      state: 'ok',
      instruments: (data.items ?? [])
        .filter((i) => isSymbolAllowed(access, i.symbol))
        .map((i) => ({
          symbol: i.symbol,
          name: i.name,
          digits: i.digits,
          icon: iconBase && i.icon ? `${iconBase}${i.icon}` : null,
        })),
    };
  } catch {
    return { state: 'catalog-unavailable', reason: 'network' };
  }
}

export type VerificationStatus = 'none' | 'pending' | 'approved' | 'rejected';

export function toVerificationStatus(state: VerificationState | null): VerificationStatus {
  switch (state) {
    case 'verified':
      return 'approved';
    case 'pending':
      return 'pending';
    case 'rejected':
      return 'rejected';
    default:
      return 'none';
  }
}

export async function getVerificationStatus(userId: string): Promise<VerificationStatus> {
  return toVerificationStatus(await getVerificationState(userId));
}
