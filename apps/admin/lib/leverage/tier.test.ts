import { describe, expect, it } from 'vitest';
import { pickUpgrade, validateThresholds, type TierPortfolio } from './tier';

const P = (key: string, min: number, order: number, extra: Partial<TierPortfolio> = {}): TierPortfolio => ({
  key,
  title: key,
  minBalanceMinor: min,
  sortOrder: order,
  isDefault: key === 'standard',
  isPublic: true,
  ...extra,
});

const SET = [P('standard', 0, 10), P('pro', 500_000, 20), P('enc_prime', 5_000_000, 30)];

describe('pickUpgrade — тип счёта по балансу, только вверх', () => {
  it('баланс ниже порога Pro — остаётся Standard', () => {
    expect(pickUpgrade(SET, null, 499_999)).toBeNull();
    expect(pickUpgrade(SET, 'standard', 0)).toBeNull();
  });
  it('ровно порог Pro — Pro; без строки клиента считается портфель по умолчанию', () => {
    expect(pickUpgrade(SET, null, 500_000)?.key).toBe('pro');
  });
  it('баланс сразу выше ENC Prime — прыжок через ступень', () => {
    expect(pickUpgrade(SET, 'standard', 6_000_000)?.key).toBe('enc_prime');
  });
  it('уже на старшем — понижения нет, даже если баланс упал', () => {
    expect(pickUpgrade(SET, 'enc_prime', 10)).toBeNull();
    expect(pickUpgrade(SET, 'enc_prime', 600_000)).toBeNull();
  });
  it('выставлен вручную Pro, баланс дорос до ENC Prime — повышаем выше ручного', () => {
    expect(pickUpgrade(SET, 'pro', 5_000_000)?.key).toBe('enc_prime');
  });
  it('закрытый (непубличный) портфель автоматически не выдаётся', () => {
    const set = [P('standard', 0, 10), P('vip', 100, 20, { isPublic: false })];
    expect(pickUpgrade(set, null, 1_000_000)).toBeNull();
  });
  it('порог не задан (0 у старших портфелей, как сразу после миграции) — никого не повышаем', () => {
    const fresh = [P('standard', 0, 10), P('pro', 0, 20), P('enc_prime', 0, 30)];
    expect(pickUpgrade(fresh, null, 10_000_000)).toBeNull();
    const partly = [P('standard', 0, 10), P('pro', 500_000, 20), P('enc_prime', 0, 30)];
    expect(pickUpgrade(partly, null, 10_000_000)?.key).toBe('pro');
  });
  it('отрицательный или нечисловой баланс — ничего не делаем', () => {
    expect(pickUpgrade(SET, null, -1)).toBeNull();
    expect(pickUpgrade(SET, null, Number.NaN)).toBeNull();
  });
});

describe('validateThresholds — пороги растут по порядку портфелей', () => {
  it('нормальная лесенка проходит', () => {
    expect(validateThresholds(SET)).toEqual({ ok: true });
  });
  it('у портфеля по умолчанию порог не 0 — отказ', () => {
    expect(validateThresholds([P('standard', 1, 10), P('pro', 500_000, 20)])).toEqual({
      ok: false,
      reason: 'defaultNotZero',
      key: 'standard',
    });
  });
  it('незаданный порог старшего портфеля не мешает задать порог младшему', () => {
    expect(validateThresholds([P('standard', 0, 10), P('pro', 500_000, 20), P('enc_prime', 0, 30)])).toEqual({ ok: true });
  });
  it('старший дешевле младшего — отказ с названием пары', () => {
    expect(validateThresholds([P('standard', 0, 10), P('pro', 500_000, 20), P('enc_prime', 400_000, 30)])).toEqual({
      ok: false,
      reason: 'notMonotonic',
      lower: 'pro',
      higher: 'enc_prime',
    });
  });
});
