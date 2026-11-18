import type { Quote } from '@broker/realtime';

type QuoteWithChange = Quote & { changePercent: number };

export function selectGainers(quotes: readonly Quote[]): QuoteWithChange[] {
  return quotes
    .filter((q): q is QuoteWithChange => q.changePercent !== null && q.changePercent > 0)
    .sort((a, b) => b.changePercent - a.changePercent);
}
