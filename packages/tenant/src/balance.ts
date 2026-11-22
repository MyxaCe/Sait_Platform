export type TenantStartBalanceUnavailableReason =
  | 'not-configured'
  | 'http-error'
  | 'network'
  | 'malformed';

export type TenantStartBalance =
  | { readonly state: 'set'; readonly cents: number }
  | { readonly state: 'unset' }
  | { readonly state: 'unavailable'; readonly reason: TenantStartBalanceUnavailableReason };

export const START_BALANCE_UNAVAILABLE: Readonly<
  Record<TenantStartBalanceUnavailableReason, TenantStartBalance>
> = {
  'not-configured': { state: 'unavailable', reason: 'not-configured' },
  'http-error': { state: 'unavailable', reason: 'http-error' },
  network: { state: 'unavailable', reason: 'network' },
  malformed: { state: 'unavailable', reason: 'malformed' },
};

export function readStartBalance(raw: unknown): TenantStartBalance {
  if (raw === null) return { state: 'unset' };
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
    return START_BALANCE_UNAVAILABLE.malformed;
  }
  return { state: 'set', cents: raw };
}
