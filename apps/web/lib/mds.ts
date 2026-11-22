import {
  INSTRUMENT_CATEGORIES,
  parseQuotesState,
  type InstrumentCategory,
  type QuotesState,
} from '@broker/realtime';

interface MdsInstrumentItem {
  symbol?: unknown;
  name?: unknown;
  category?: unknown;
  digits?: unknown;
  priceDecimals?: unknown;
  minQty?: unknown;
  icon?: string | null;
}

export type MdsCatalogUnavailableReason =
  | 'not-configured'
  | 'network'
  | 'http-error'
  | 'malformed'
  | 'empty';

export type MdsCatalog =
  | { state: 'available'; symbols: Set<string> }
  | { state: 'unavailable'; reason: MdsCatalogUnavailableReason };

type FetchOutcome =
  | { ok: true; items: MdsInstrumentItem[] }
  | { ok: false; reason: Exclude<MdsCatalogUnavailableReason, 'empty'> };

async function fetchMdsInstruments(): Promise<FetchOutcome> {
  const url = process.env.MDS_HTTP_URL;
  if (!url) return { ok: false, reason: 'not-configured' };
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/v1/instruments`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return { ok: false, reason: 'http-error' };

    let data: { items?: MdsInstrumentItem[] };
    try {
      data = (await res.json()) as { items?: MdsInstrumentItem[] };
    } catch {
      return { ok: false, reason: 'malformed' };
    }

    if (!Array.isArray(data.items)) return { ok: false, reason: 'malformed' };
    return { ok: true, items: data.items };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

let lastReason: MdsCatalogUnavailableReason | null | undefined;
let repeats = 0;

export function __resetCatalogLogState(): void {
  lastReason = undefined;
  repeats = 0;
}

function reportCatalogState(reason: MdsCatalogUnavailableReason | null): void {
  if (reason === lastReason) {
    repeats += 1;
    return;
  }

  if (reason === null) {
    console.info(
      `[mds] каталог снова доступен (предыдущее состояние: ${lastReason ?? 'неизвестно'}` +
        `${repeats > 0 ? `, повторов подряд: ${repeats}` : ''})`,
    );
  } else {
    console.error(
      `[mds] каталог недоступен: ${reason}. Строка котировок закрыта, ` +
        'выдуманные символы не подставляются (Р-050).',
    );
  }

  lastReason = reason;
  repeats = 0;
}

export async function getMdsCatalog(): Promise<MdsCatalog> {
  const outcome = await fetchMdsInstruments();
  if (!outcome.ok) {
    reportCatalogState(outcome.reason);
    return { state: 'unavailable', reason: outcome.reason };
  }

  const symbols = new Set(
    outcome.items.map((i) => i.symbol).filter((s): s is string => typeof s === 'string' && s.length > 0),
  );
  if (symbols.size === 0) {
    reportCatalogState('empty');
    return { state: 'unavailable', reason: 'empty' };
  }

  reportCatalogState(null);
  return { state: 'available', symbols };
}

export interface MdsCatalogEntry {
  symbol: string;
  name: string | null;
  category: InstrumentCategory | null;
  digits: number | null;
  minQty: string | null;
}

export type MdsCatalogEntries =
  | { state: 'available'; entries: Record<string, MdsCatalogEntry> }
  | { state: 'unavailable'; reason: Exclude<MdsCatalogUnavailableReason, 'empty'> };

function catalogDigits(item: MdsInstrumentItem): number | null {
  const raw = item.digits ?? item.priceDecimals;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 12 ? raw : null;
}

export function catalogEntryOf(item: MdsInstrumentItem): MdsCatalogEntry | null {
  if (typeof item.symbol !== 'string' || item.symbol.length === 0) return null;
  return {
    symbol: item.symbol,
    name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : null,
    category:
      typeof item.category === 'string' && (INSTRUMENT_CATEGORIES as readonly string[]).includes(item.category)
        ? (item.category as InstrumentCategory)
        : null,
    digits: catalogDigits(item),
    minQty: typeof item.minQty === 'string' && /^\d+(\.\d+)?$/.test(item.minQty) ? item.minQty : null,
  };
}

export async function getMdsCatalogEntries(): Promise<MdsCatalogEntries> {
  const outcome = await fetchMdsInstruments();
  if (!outcome.ok) return { state: 'unavailable', reason: outcome.reason };
  const entries: Record<string, MdsCatalogEntry> = {};
  for (const item of outcome.items) {
    const entry = catalogEntryOf(item);
    if (entry) entries[entry.symbol] = entry;
  }
  return { state: 'available', entries };
}

export async function getMdsIcons(): Promise<Record<string, string>> {
  const base = process.env.NEXT_PUBLIC_WS_URL?.replace(/\/$/, '');
  if (!base) return {};
  const outcome = await fetchMdsInstruments();
  if (!outcome.ok) return {};
  const icons: Record<string, string> = {};
  for (const item of outcome.items) {
    if (typeof item.symbol === 'string' && item.symbol && item.icon) icons[item.symbol] = `${base}${item.icon}`;
  }
  return icons;
}

export type MdsQuotesOutcome =
  | { state: 'available'; quotes: QuotesState }
  | { state: 'unavailable'; reason: Exclude<MdsCatalogUnavailableReason, 'empty'> };

export async function getMdsQuotesState(): Promise<MdsQuotesOutcome> {
  const url = process.env.MDS_HTTP_URL;
  if (!url) return { state: 'unavailable', reason: 'not-configured' };
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/v1/quotes`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return { state: 'unavailable', reason: 'http-error' };

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { state: 'unavailable', reason: 'malformed' };
    }

    return { state: 'available', quotes: parseQuotesState(body) };
  } catch {
    return { state: 'unavailable', reason: 'network' };
  }
}
