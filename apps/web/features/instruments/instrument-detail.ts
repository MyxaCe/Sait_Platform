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

export function resolveInstrument({ category, symbol, cmsItems, access, catalog }: ResolveInput): InstrumentDetail {
  if (!URL_SYMBOL.test(symbol)) return NOT_FOUND;
  const upper = symbol.toUpperCase();

  const cms = cmsItems.find((i) => i.symbol.toUpperCase() === upper);
  if (!cms) return NOT_FOUND;

  const entry = catalog.state === 'available' ? catalog.entries[cms.symbol] : undefined;
  if (catalog.state === 'available' && !entry) return NOT_FOUND;

  const resolvedCategory = entry?.category ?? cms.category;
  if (resolvedCategory !== category) return NOT_FOUND;

  const name = entry?.name ?? cms.name;

  const notice = accessNotice(access);
  if (notice) return { kind: 'closed', symbol: cms.symbol, name, notice };
  if (!isSymbolAllowed(access, cms.symbol)) return NOT_FOUND;

  return {
    kind: 'ok',
    instrument: {
      symbol: cms.symbol,
      name,
      category: resolvedCategory,
      digits: entry?.digits ?? null,
      minQty: entry?.minQty ?? null,
      swapFree: cms.swapFree,
      cmsIconUrl: cms.icon?.url ?? null,
    },
  };
}
