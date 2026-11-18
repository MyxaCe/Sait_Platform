import { INSTRUMENT_CATEGORIES, type InstrumentCategory, type Quote } from './types';

const MODELLED_FIELDS = [
  'symbol',
  'name',
  'category',
  'price',
  'digits',
  'changePercent',
  'bid',
  'ask',
  'ts',
] as const;

const ACKNOWLEDGED_FIELDS = ['source'] as const;

const KNOWN_FIELDS: ReadonlySet<string> = new Set<string>([
  ...MODELLED_FIELDS,
  ...ACKNOWLEDGED_FIELDS,
]);

export interface RejectedQuote {
  symbol: string | null;
  field: string;
  reason: 'missing' | 'wrong-type' | 'unknown-value';
}

export interface QuoteBatchParse {
  quotes: Quote[];
  rejected: RejectedQuote[];
  novelties: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isTradablePrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isCategory(value: unknown): value is InstrumentCategory {
  return typeof value === 'string' && (INSTRUMENT_CATEGORIES as readonly string[]).includes(value);
}

function parseQuote(
  raw: Record<string, unknown>,
  rejected: RejectedQuote[],
  novelties: string[],
): Quote | null {
  const symbol = raw.symbol;
  if (typeof symbol !== 'string' || symbol.length === 0) {
    rejected.push({
      symbol: null,
      field: 'symbol',
      reason: symbol === undefined ? 'missing' : 'wrong-type',
    });
    return null;
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN_FIELDS.has(key)) novelties.push(`field:${key}`);
  }

  const fail = (field: string, reason: RejectedQuote['reason']): null => {
    rejected.push({ symbol, field, reason });
    return null;
  };

  const { name, category, price, digits, ts } = raw;

  if (typeof name !== 'string' || name.length === 0) {
    return fail('name', name === undefined ? 'missing' : 'wrong-type');
  }
  if (!isCategory(category)) {
    if (typeof category === 'string' && category.length > 0) {
      novelties.push(`category:${category}`);
      return fail('category', 'unknown-value');
    }
    return fail('category', category === undefined ? 'missing' : 'wrong-type');
  }
  if (!isFiniteNumber(price)) return fail('price', price === undefined ? 'missing' : 'wrong-type');
  if (!isNonNegativeInteger(digits)) {
    return fail('digits', digits === undefined ? 'missing' : 'wrong-type');
  }
  if (!isFiniteNumber(ts) || ts < 0) return fail('ts', ts === undefined ? 'missing' : 'wrong-type');

  const rawChange = raw.changePercent;
  let changePercent: number | null = null;
  if (isFiniteNumber(rawChange)) {
    changePercent = rawChange;
  } else if (rawChange !== undefined && rawChange !== null) {
    rejected.push({ symbol, field: 'changePercent', reason: 'wrong-type' });
  }

  const bid = parseSideQuote(raw.bid, 'bid', symbol, rejected);
  const ask = parseSideQuote(raw.ask, 'ask', symbol, rejected);

  return { symbol, name, category, price, digits, changePercent, bid, ask, ts };
}

function parseSideQuote(
  value: unknown,
  field: 'bid' | 'ask',
  symbol: string,
  rejected: RejectedQuote[],
): number | null {
  if (value === undefined || value === null) return null;
  if (isTradablePrice(value)) return value;
  rejected.push({
    symbol,
    field,
    reason: typeof value === 'number' ? 'unknown-value' : 'wrong-type',
  });
  return null;
}

export function parseQuoteBatch(raw: unknown): QuoteBatchParse {
  const rejected: RejectedQuote[] = [];
  const novelties: string[] = [];

  if (!Array.isArray(raw)) {
    rejected.push({ symbol: null, field: '(batch)', reason: 'wrong-type' });
    return { quotes: [], rejected, novelties };
  }

  const quotes: Quote[] = [];
  for (const item of raw) {
    if (!isObject(item)) {
      rejected.push({ symbol: null, field: '(item)', reason: 'wrong-type' });
      continue;
    }
    const quote = parseQuote(item, rejected, novelties);
    if (quote) quotes.push(quote);
  }

  return { quotes, rejected, novelties: [...new Set(novelties)] };
}
