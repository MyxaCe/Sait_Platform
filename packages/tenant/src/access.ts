export type TenantAccessUnavailableReason =
  | 'not-configured'
  | 'http-error'
  | 'network'
  | 'malformed'
  | 'expired'
  | 'expiry-malformed';

export type TenantAccess =
  | { readonly state: 'allowed'; readonly symbols: ReadonlySet<string> }
  | { readonly state: 'empty' }
  | { readonly state: 'unavailable'; readonly reason: TenantAccessUnavailableReason };

export const UNAVAILABLE: Readonly<Record<TenantAccessUnavailableReason, TenantAccess>> = {
  'not-configured': { state: 'unavailable', reason: 'not-configured' },
  'http-error': { state: 'unavailable', reason: 'http-error' },
  network: { state: 'unavailable', reason: 'network' },
  malformed: { state: 'unavailable', reason: 'malformed' },
  expired: { state: 'unavailable', reason: 'expired' },
  'expiry-malformed': { state: 'unavailable', reason: 'expiry-malformed' },
};

export function isSymbolAllowed(access: TenantAccess, symbol: string): boolean {
  return access.state === 'allowed' && access.symbols.has(symbol);
}

export function isAccessClosed(access: TenantAccess): boolean {
  return access.state !== 'allowed';
}

export interface AccessNoticeSpec {
  readonly state: 'empty' | 'unavailable';
  readonly titleKey: 'accessEmptyTitle' | 'accessUnavailableTitle';
  readonly textKey: 'accessEmptyText' | 'accessUnavailableText';
  readonly stripKey: 'accessEmptyStrip' | 'accessUnavailableStrip';
  readonly reason?: TenantAccessUnavailableReason;
}

export function accessNotice(access: TenantAccess): AccessNoticeSpec | null {
  switch (access.state) {
    case 'allowed':
      return null;
    case 'empty':
      return {
        state: 'empty',
        titleKey: 'accessEmptyTitle',
        textKey: 'accessEmptyText',
        stripKey: 'accessEmptyStrip',
      };
    case 'unavailable':
      return {
        state: 'unavailable',
        titleKey: 'accessUnavailableTitle',
        textKey: 'accessUnavailableText',
        stripKey: 'accessUnavailableStrip',
        reason: access.reason,
      };
  }
}

export function readAccess(instruments: unknown): TenantAccess {
  if (!Array.isArray(instruments)) return UNAVAILABLE.malformed;
  if (instruments.length === 0) return { state: 'empty' };
  return { state: 'allowed', symbols: new Set(instruments.map(String)) };
}
