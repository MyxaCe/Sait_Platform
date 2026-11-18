export interface ClosedDeal {
  symbol: string;
  side: 'buy' | 'sell';
  volume: number;
  entry: number;
  exit: number;
  pnlCents: number;
  level: number | null;
  acrossGap: boolean | null;
  priceDigits: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function unscale(value: number, decimals: number): number {
  return value / 10 ** decimals;
}

export function parseClosedDeal(raw: unknown): ClosedDeal | null {
  if (!isObject(raw)) return null;

  const { symbol, side, qty, entry, exit, pnl, level, across_gap, price_decimals, qty_decimals } =
    raw;

  if (typeof symbol !== 'string' || symbol.length === 0) return null;
  if (side !== 'buy' && side !== 'sell') return null;
  if (!isInt(price_decimals) || !isInt(qty_decimals)) return null;
  if (!isInt(entry) || !isInt(exit) || !isInt(qty) || !isInt(pnl)) return null;

  return {
    symbol,
    side,
    volume: unscale(qty, qty_decimals),
    entry: unscale(entry, price_decimals),
    exit: unscale(exit, price_decimals),
    pnlCents: pnl,
    level: isInt(level) ? unscale(level, price_decimals) : null,
    acrossGap: typeof across_gap === 'boolean' ? across_gap : null,
    priceDigits: price_decimals,
  };
}

export function parseClosedDeals(body: unknown): ClosedDeal[] {
  if (!Array.isArray(body)) return [];
  return body
    .map(parseClosedDeal)
    .filter((deal): deal is ClosedDeal => deal !== null);
}
