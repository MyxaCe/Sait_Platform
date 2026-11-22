export interface TickerAccess {
  state: 'allowed' | 'empty' | 'unavailable';
  reason?: string;
  symbols: string[];
}

export interface TickerCatalog {
  state: 'available' | 'unavailable';
  reason?: string;
  symbols: string[];
}

export type TickerDecision =
  | { kind: 'ticker'; symbols: string[] }
  | {
      kind: 'notice';
      state: 'empty' | 'unavailable';
      reason?: string;
    };

export const QUOTES_REASON_PREFIX = 'quotes:';

export const NO_OVERLAP_REASON = `${QUOTES_REASON_PREFIX}no-overlap`;

export function decideTicker(
  candidates: string[],
  access: TickerAccess,
  catalog: TickerCatalog,
): TickerDecision {
  if (access.state !== 'allowed') {
    return { kind: 'notice', state: access.state, reason: access.reason };
  }

  if (catalog.state !== 'available') {
    return {
      kind: 'notice',
      state: 'unavailable',
      reason: catalog.reason ? `${QUOTES_REASON_PREFIX}${catalog.reason}` : undefined,
    };
  }

  const allowed = new Set(access.symbols);
  const streaming = new Set(catalog.symbols);
  const ordered = new Set([...candidates.filter((s) => allowed.has(s)), ...access.symbols]);
  const symbols = [...ordered].filter((s) => streaming.has(s));

  if (symbols.length === 0) {
    return { kind: 'notice', state: 'empty', reason: NO_OVERLAP_REASON };
  }

  return { kind: 'ticker', symbols };
}
