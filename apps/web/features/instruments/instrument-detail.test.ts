import { describe, expect, it } from 'vitest';
import type { Instrument } from '@broker/api-client';
import type { TenantAccess } from '@broker/tenant';
import type { MdsCatalogEntries, MdsCatalogEntry } from '@/lib/mds';
import { resolveInstrument, type ResolveInput } from './instrument-detail';

const cmsItem = (over: Partial<Instrument> = {}): Instrument => ({
  symbol: 'LTCUSD',
  name: 'Litecoin (CMS)',
  category: 'crypto',
  digits: 2,
  spreadFrom: '0.1',
  swapFree: true,
  icon: null,
  ...over,
});

const allowed = (...symbols: string[]): TenantAccess => ({ state: 'allowed', symbols: new Set(symbols) });

const catalog = (...entries: MdsCatalogEntry[]): MdsCatalogEntries => ({
  state: 'available',
  entries: Object.fromEntries(entries.map((e) => [e.symbol, e])),
});

const LTC = { symbol: 'LTCUSD', name: 'Litecoin', category: 'crypto' as const, digits: 2, minQty: null };
const EUR = { symbol: 'EURUSD', name: 'Euro / US Dollar', category: 'forex' as const, digits: 5, minQty: '0.01' };

const input = (over: Partial<ResolveInput> = {}): ResolveInput => ({
  category: 'crypto',
  symbol: 'ltcusd',
  cmsItems: [cmsItem(), cmsItem({ symbol: 'EURUSD', name: 'Евро', category: 'forex', digits: 5 })],
  access: allowed('LTCUSD', 'EURUSD'),
  catalog: catalog(LTC, EUR),
  ...over,
});

describe('деталка инструмента · какие инструменты существуют', () => {
  it('символ вне клиентского справочника, но в CMS ∩ доступ ∩ каталог → страница есть', () => {
    const r = resolveInstrument(input());

    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.instrument).toMatchObject({ symbol: 'LTCUSD', name: 'Litecoin', category: 'crypto', digits: 2, swapFree: true });
  });

  it('название, категория и точность — из каталога MDS, а не из CMS', () => {
    const r = resolveInstrument(
      input({ category: 'forex', symbol: 'eurusd', cmsItems: [cmsItem({ symbol: 'EURUSD', name: 'Евро', category: 'forex', digits: 3 })] }),
    );

    expect(r).toMatchObject({ kind: 'ok', instrument: { name: 'Euro / US Dollar', digits: 5, minQty: '0.01' } });
  });

  it.each([
    ['нет в CMS', input({ cmsItems: [] })],
    ['нет в каталоге MDS', input({ catalog: catalog(EUR) })],
    ['нет в списке доступа сайта', input({ access: allowed('EURUSD') })],
    ['категория в адресе чужая', input({ category: 'forex' })],
    ['мусор в адресе', input({ symbol: 'ltc%2Fusd' })],
  ])('%s → 404', (_why, given) => {
    expect(resolveInstrument(given)).toEqual({ kind: 'not-found' });
  });

  it('категория берётся из каталога: CMS сказала crypto, каталог — forex', () => {
    const given = input({ cmsItems: [cmsItem({ category: 'crypto' })], catalog: catalog({ ...LTC, category: 'forex' }) });

    expect(resolveInstrument(given).kind).toBe('not-found');
    expect(resolveInstrument({ ...given, category: 'forex' }).kind).toBe('ok');
  });

  it('граница доступа закрыта → не 404, а объяснение', () => {
    const r = resolveInstrument(input({ access: { state: 'unavailable', reason: 'network' } }));

    expect(r).toMatchObject({ kind: 'closed', symbol: 'LTCUSD', name: 'Litecoin' });
  });

  it('каталог MDS недоступен → страница из CMS, точность неизвестна, а не выдумана', () => {
    const r = resolveInstrument(input({ catalog: { state: 'unavailable', reason: 'network' } }));

    expect(r).toMatchObject({
      kind: 'ok',
      instrument: { name: 'Litecoin (CMS)', category: 'crypto', digits: null, minQty: null },
    });
  });
});
