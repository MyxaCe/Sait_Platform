import type { ConnStatus } from '@broker/realtime';
import { isLiveFeed } from './mode';
import { createSeries, pushSample, type Series } from './series';

export interface QuoteReading {
  price: number;
  ts: number;
}

export interface Collector {
  series: Map<string, Series>;
  seen: Map<string, number>;
}

export function createCollector(): Collector {
  return { series: new Map(), seen: new Map() };
}

export function resetCollector(collector: Collector): void {
  collector.series.clear();
  collector.seen.clear();
}

export function collect(
  collector: Collector,
  status: ConnStatus,
  quotes: Readonly<Record<string, QuoteReading | undefined>>,
  symbols: readonly string[],
  now: number,
): number {
  if (!isLiveFeed(status)) {
    resetCollector(collector);
    return 0;
  }
  let added = 0;
  for (const symbol of symbols) {
    const quote = quotes[symbol];
    if (!quote || !(quote.ts > 0)) continue;
    if (collector.seen.get(symbol) === quote.ts) continue;
    let series = collector.series.get(symbol);
    if (!series) {
      series = createSeries();
      collector.series.set(symbol, series);
    }
    if (pushSample(series, now, quote.price)) {
      collector.seen.set(symbol, quote.ts);
      added += 1;
    }
  }
  return added;
}

export function drawable(
  collector: Collector,
  status: ConnStatus,
  symbols: readonly string[],
): { symbol: string; series: Series }[] {
  if (!isLiveFeed(status)) return [];
  const out: { symbol: string; series: Series }[] = [];
  for (const symbol of symbols) {
    const series = collector.series.get(symbol);
    if (series && series.samples.length > 0) out.push({ symbol, series });
  }
  return out;
}
