import { describe, expect, it } from 'vitest';
import {
  resolveLeverage,
  buildAccountLeverageSnapshot,
  formatLeverage,
  type PortfolioLeverage,
  type ClientLeverageOverride,
} from './resolve';

/**
 * Р-446 · приоритет разрешения плеча: override клиента › override класса ›
 * портфель. Проверяем каждую ветку и — отдельно — что override клиента НЕ
 * подчинён классу (адресное решение важнее планки класса).
 */

const STANDARD: PortfolioLeverage = {
  key: 'standard',
  title: 'Standard',
  baseLeverage: 20,
  classOverrides: { crypto: 10 },
};

const OVERRIDE: ClientLeverageOverride = { leverage: 5, reason: 'заявка риск-деска', ticket: 'RISK-77' };

describe('Р-446 · resolveLeverage', () => {
  it('нет override, класс без планки → база портфеля', () => {
    const r = resolveLeverage({ portfolio: STANDARD, clientOverride: null, instrumentClass: 'fx' });
    expect(r).toEqual({ leverage: 20, source: 'portfolio', instrumentClass: null, portfolioKey: 'standard' });
  });

  it('нет override, класс без указания → база портфеля', () => {
    const r = resolveLeverage({ portfolio: STANDARD, clientOverride: null, instrumentClass: null });
    expect(r.leverage).toBe(20);
    expect(r.source).toBe('portfolio');
  });

  it('нет override, класс crypto с планкой → class-override', () => {
    const r = resolveLeverage({ portfolio: STANDARD, clientOverride: null, instrumentClass: 'crypto' });
    expect(r).toEqual({ leverage: 10, source: 'class-override', instrumentClass: 'crypto', portfolioKey: 'standard' });
  });

  it('override клиента перекрывает базу портфеля', () => {
    const r = resolveLeverage({ portfolio: STANDARD, clientOverride: OVERRIDE, instrumentClass: 'fx' });
    expect(r).toEqual({ leverage: 5, source: 'client-override', instrumentClass: null, portfolioKey: 'standard' });
  });

  it('override клиента перекрывает ДАЖЕ class-override (адресное решение важнее планки класса)', () => {
    const r = resolveLeverage({ portfolio: STANDARD, clientOverride: OVERRIDE, instrumentClass: 'crypto' });
    expect(r.leverage).toBe(5);
    expect(r.source).toBe('client-override');
  });

  it('class-override 0 как ключ не «проваливается»: hasOwnProperty, не truthy', () => {
    const zeroish: PortfolioLeverage = { ...STANDARD, classOverrides: { crypto: 1 } };
    const r = resolveLeverage({ portfolio: zeroish, clientOverride: null, instrumentClass: 'crypto' });
    expect(r.leverage).toBe(1);
    expect(r.source).toBe('class-override');
  });
});

describe('Р-446 · buildAccountLeverageSnapshot (предложение контракта терминалу)', () => {
  it('везёт спецификацию целиком: база + class-override + override клиента', () => {
    const snap = buildAccountLeverageSnapshot(STANDARD, OVERRIDE, '2026-11-01T00:00:00.000Z');
    expect(snap).toEqual({
      portfolioKey: 'standard',
      baseLeverage: 20,
      classOverrides: { crypto: 10 },
      clientOverride: 5,
      resolvedAt: '2026-11-01T00:00:00.000Z',
    });
  });

  it('без override клиента → clientOverride: null, class-override сохранён', () => {
    const snap = buildAccountLeverageSnapshot(STANDARD, null, '2026-11-01T00:00:00.000Z');
    expect(snap.clientOverride).toBeNull();
    expect(snap.classOverrides).toEqual({ crypto: 10 });
  });

  it('classOverrides в снимке — копия, не ссылка на портфель', () => {
    const snap = buildAccountLeverageSnapshot(STANDARD, null);
    expect(snap.classOverrides).not.toBe(STANDARD.classOverrides);
  });
});

describe('formatLeverage', () => {
  it('знаменатель → 1:N', () => {
    expect(formatLeverage(20)).toBe('1:20');
    expect(formatLeverage(100)).toBe('1:100');
  });
});
