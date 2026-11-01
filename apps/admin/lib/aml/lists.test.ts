import { describe, expect, it } from 'vitest';
import {
  asAmlStatus,
  isSanctionsListId,
  normalizeSanctionsLists,
  SANCTIONS_LISTS,
} from './lists';

/**
 * ADM-14 · словарь AML — чистые помощники. Источник правды о множестве —
 * CHECK в схеме; эти функции приводят вход к известному значению fail-closed.
 */

describe('ADM-14 · asAmlStatus', () => {
  it('принимает известные статусы', () => {
    expect(asAmlStatus('unscreened')).toBe('unscreened');
    expect(asAmlStatus('clear')).toBe('clear');
    expect(asAmlStatus('escalated')).toBe('escalated');
  });

  it('на неизвестном — бросает (не «наверное ок»)', () => {
    expect(() => asAmlStatus('maybe')).toThrow();
    expect(() => asAmlStatus(null)).toThrow();
  });
});

describe('ADM-14 · списки санкций', () => {
  it('реестр — ровно OFSI/OFAC/EU', () => {
    expect(SANCTIONS_LISTS.map((l) => l.id)).toEqual(['ofsi', 'ofac', 'eu']);
  });

  it('isSanctionsListId узнаёт только реестровые id', () => {
    expect(isSanctionsListId('ofac')).toBe(true);
    expect(isSanctionsListId('world-check')).toBe(false);
    expect(isSanctionsListId(42)).toBe(false);
  });

  it('normalize отбрасывает неизвестное и дубли, возвращает в порядке реестра', () => {
    expect(normalizeSanctionsLists(['eu', 'ofsi', 'eu', 'xyz'])).toEqual(['ofsi', 'eu']);
  });

  it('normalize на пустом/мусорном входе даёт пустой список', () => {
    expect(normalizeSanctionsLists([])).toEqual([]);
    expect(normalizeSanctionsLists([null, 1, {}])).toEqual([]);
  });
});
