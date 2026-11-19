import { decideTicker, type TickerAccess, type TickerCatalog } from '@/features/quotes/ticker-decision';

export const MAX_BACKDROP_SYMBOLS = 5;

export function pickBackdropSymbols(
  candidates: readonly string[],
  access: TickerAccess,
  catalog: TickerCatalog,
  max: number = MAX_BACKDROP_SYMBOLS,
): string[] {
  const decision = decideTicker([...candidates], access, catalog);
  return decision.kind === 'ticker' ? decision.symbols.slice(0, max) : [];
}

const CLOSED_ACCESS: TickerAccess = { state: 'unavailable', reason: 'network', symbols: [] };
const CLOSED_CATALOG: TickerCatalog = { state: 'unavailable', reason: 'network', symbols: [] };

async function ask<T>(url: string, closed: T, signal: AbortSignal): Promise<T> {
  try {
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok) return closed;
    return (await res.json()) as T;
  } catch (error) {
    if (signal.aborted) throw error;
    return closed;
  }
}

export async function loadBackdropSymbols(
  candidates: readonly string[],
  signal: AbortSignal,
): Promise<string[]> {
  const [access, catalog] = await Promise.all([
    ask('/api/tenant/access', CLOSED_ACCESS, signal),
    ask('/api/quotes/catalog', CLOSED_CATALOG, signal),
  ]);
  return pickBackdropSymbols(candidates, access, catalog);
}
