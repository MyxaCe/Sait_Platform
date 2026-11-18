import { parseQuotesState, type QuotesState } from '@broker/realtime';

interface MdsInstrumentItem {
  symbol?: string;
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
    outcome.items.map((i) => i.symbol).filter((s): s is string => Boolean(s)),
  );
  if (symbols.size === 0) {
    reportCatalogState('empty');
    return { state: 'unavailable', reason: 'empty' };
  }

  reportCatalogState(null);
  return { state: 'available', symbols };
}

export async function getMdsIcons(): Promise<Record<string, string>> {
  const base = process.env.NEXT_PUBLIC_WS_URL?.replace(/\/$/, '');
  if (!base) return {};
  const outcome = await fetchMdsInstruments();
  if (!outcome.ok) return {};
  const icons: Record<string, string> = {};
  for (const item of outcome.items) {
    if (item.symbol && item.icon) icons[item.symbol] = `${base}${item.icon}`;
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
