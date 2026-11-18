import { ms, type TradeFact } from './facts';

export interface TurnoverResult {
  qualifyingMinor: number;
  grossMinor: number;
  shortHolds: number;
}

interface Lot {
  qty: number;
  price: number;
  openedAt: number;
}

const EPS = 1e-12;

const toCents = (usd: number): number => Math.round(usd * 100);

export function computeTurnover(
  trades: readonly TradeFact[],
  opts: { minHoldSeconds: number; from?: string | null; until?: string | null },
): TurnoverResult {
  const fromMs = opts.from ? ms(opts.from) : Number.NEGATIVE_INFINITY;
  const untilMs = opts.until ? ms(opts.until) : Number.POSITIVE_INFINITY;
  const inWindow = trades
    .filter((t) => Number.isFinite(t.volume) && t.volume > 0 && Number.isFinite(t.price) && t.price > 0)
    .filter((t) => {
      const at = ms(t.executedAt);
      return at >= fromMs && at <= untilMs;
    })
    .sort((a, b) => ms(a.executedAt) - ms(b.executedAt));

  let grossUsd = 0;
  for (const t of inWindow) grossUsd += t.volume * t.price;

  if (opts.minHoldSeconds <= 0) {
    const cents = toCents(grossUsd);
    return { qualifyingMinor: cents, grossMinor: cents, shortHolds: 0 };
  }

  const holdMs = opts.minHoldSeconds * 1000;
  const book = new Map<string, { sign: 1 | -1 | 0; lots: Lot[] }>();
  let qualifyingUsd = 0;
  let shortHolds = 0;

  for (const t of inWindow) {
    const at = ms(t.executedAt);
    const dir: 1 | -1 = t.side === 'buy' ? 1 : -1;
    const pos = book.get(t.symbol) ?? { sign: 0 as const, lots: [] };
    let remaining = t.volume;

    if (pos.sign !== 0 && pos.sign !== dir) {
      while (remaining > EPS && pos.lots.length > 0) {
        const lot = pos.lots[0]!;
        const take = Math.min(lot.qty, remaining);
        if (at - lot.openedAt >= holdMs) {
          qualifyingUsd += take * lot.price + take * t.price;
        } else {
          shortHolds += 1;
        }
        lot.qty -= take;
        remaining -= take;
        if (lot.qty <= EPS) pos.lots.shift();
      }
      if (pos.lots.length === 0) pos.sign = 0;
    }
    if (remaining > EPS) {
      pos.lots.push({ qty: remaining, price: t.price, openedAt: at });
      pos.sign = dir;
    }
    book.set(t.symbol, pos);
  }

  return { qualifyingMinor: toCents(qualifyingUsd), grossMinor: toCents(grossUsd), shortHolds };
}
