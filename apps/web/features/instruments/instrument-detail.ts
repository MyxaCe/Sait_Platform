import type { Instrument } from '@broker/api-client';
import type { InstrumentCategory } from '@broker/realtime';
import type { AccessNoticeSpec, TenantAccess } from '@broker/tenant';
import { accessNotice, isSymbolAllowed } from '@broker/tenant';
import type { MdsCatalogEntries } from '@/lib/mds';

const URL_SYMBOL = /^[a-z0-9._-]{1,24}$/i;

export interface InstrumentDetailData {
  symbol: string;
  name: string;
  category: InstrumentCategory;
  digits: number | null;
  minQty: string | null;
  swapFree: boolean;
  cmsIconUrl: string | null;
}

export type InstrumentDetail =
  | { kind: 'not-found' }
  | { kind: 'closed'; symbol: string; name: string; notice: AccessNoticeSpec }
  | { kind: 'ok'; instrument: InstrumentDetailData };

export interface ResolveInput {
  category: string;
  symbol: string;
  cmsItems: readonly Instrument[];
  access: TenantAccess;
  catalog: MdsCatalogEntries;
}

const NOT_FOUND: InstrumentDetail = { kind: 'not-found' };

function findSymbol(symbols: Iterable<string>, upper: string): string | undefined {
  for (const s of symbols) if (s.toUpperCase() === upper) return s;
  return undefined;
}

export function resolveInstrument({ category, symbol, cmsItems, access, catalog }: ResolveInput): InstrumentDetail {
  if (!URL_SYMBOL.test(symbol)) return NOT_FOUND;
  const upper = symbol.toUpperCase();

  const cms = cmsItems.find((i) => i.symbol.toUpperCase() === upper);
  const catalogKey = catalog.state === 'available' ? findSymbol(Object.keys(catalog.entries), upper) : undefined;
  const entry = catalogKey && catalog.state === 'available' ? catalog.entries[catalogKey] : undefined;
  if (catalog.state === 'available' && !entry) return NOT_FOUND;

  const allowedKey = access.state === 'allowed' ? findSymbol(access.symbols, upper) : undefined;
  const canonical = allowedKey ?? cms?.symbol ?? catalogKey;
  if (!canonical) return NOT_FOUND;

  const resolvedCategory = entry?.category ?? cms?.category;
  if (!resolvedCategory || resolvedCategory !== category) return NOT_FOUND;

  const name = entry?.name ?? cms?.name ?? canonical;

  const notice = accessNotice(access);
  if (notice) return { kind: 'closed', symbol: canonical, name, notice };
  if (!allowedKey || !isSymbolAllowed(access, allowedKey)) return NOT_FOUND;

  return {
    kind: 'ok',
    instrument: {
      symbol: allowedKey,
      name,
      category: resolvedCategory,
      digits: entry?.digits ?? null,
      minQty: entry?.minQty ?? null,
      swapFree: cms?.swapFree ?? false,
      cmsIconUrl: cms?.icon?.url ?? null,
    },
  };
}

export interface InstrumentPageRef {
  symbol: string;
  category: InstrumentCategory;
}

export function listInstrumentPages(input: Omit<ResolveInput, 'category' | 'symbol'>): InstrumentPageRef[] {
  if (input.access.state !== 'allowed') return [];
  const pages: InstrumentPageRef[] = [];
  const seen = new Set<string>();
  for (const symbol of [...input.cmsItems.map((i) => i.symbol), ...input.access.symbols]) {
    const upper = symbol.toUpperCase();
    const cms = input.cmsItems.find((i) => i.symbol.toUpperCase() === upper);
    const entry =
      input.catalog.state === 'available'
        ? input.catalog.entries[findSymbol(Object.keys(input.catalog.entries), upper) ?? '']
        : undefined;
    const category = entry?.category ?? cms?.category;
    if (!category || seen.has(upper)) continue;
    const detail = resolveInstrument({ ...input, category, symbol: symbol.toLowerCase() });
    if (detail.kind !== 'ok') continue;
    seen.add(upper);
    pages.push({ symbol: detail.instrument.symbol, category: detail.instrument.category });
  }
  return pages;
}
