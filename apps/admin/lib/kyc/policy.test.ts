import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JURISDICTION_PROFILE,
  sourceOfFundsRequiredByAmount,
  sourceOfFundsStatus,
} from './jurisdiction';
import { ADDRESS_PROOF_MAX_AGE_DAYS, isDocumentOlderThan } from './queries';

/**
 * ADM-11 (Р-454 I-2) — порог «источник средств» — и I-3 (Р-454 I-3) — свежесть
 * адреса. Оба правила — чистые функции; проверяем их на границах.
 */

describe('ADM-11 · порог источника средств', () => {
  it('порог по умолчанию — $10 000', () => {
    expect(DEFAULT_JURISDICTION_PROFILE.sourceOfFundsThresholdUsd).toBe(10_000);
  });

  it('единичный депозит ≥ порога — требуется (на границе включительно)', () => {
    expect(sourceOfFundsRequiredByAmount({ singleMaxUsd: 10_000, rolling30dTotalUsd: 0 })).toBe(true);
    expect(sourceOfFundsRequiredByAmount({ singleMaxUsd: 9_999, rolling30dTotalUsd: 0 })).toBe(false);
  });

  it('сумма за 30 дней ≥ порога — требуется, даже если единичные мелкие', () => {
    expect(sourceOfFundsRequiredByAmount({ singleMaxUsd: 3_000, rolling30dTotalUsd: 10_000 })).toBe(true);
    expect(sourceOfFundsRequiredByAmount({ singleMaxUsd: 3_000, rolling30dTotalUsd: 9_000 })).toBe(false);
  });

  it('статус: документ подан → submitted', () => {
    expect(sourceOfFundsStatus(true)).toBe('submitted');
  });

  it('статус: документа нет и сумм нет → консервативный флаг (не «ок»)', () => {
    expect(sourceOfFundsStatus(false)).toBe('missing_amounts_unknown');
  });

  it('статус: документа нет, но известные суммы бьют порог → точно требуется', () => {
    expect(sourceOfFundsStatus(false, { singleMaxUsd: 12_000, rolling30dTotalUsd: 0 })).toBe(
      'missing_required',
    );
  });
});

describe('I-3 · свежесть подтверждения адреса (90 дней)', () => {
  const now = new Date('2026-04-01T00:00:00.000Z');

  it('ровно 90 дней — ещё не «старше» (строго больше порога)', () => {
    const d = new Date(now.getTime() - ADDRESS_PROOF_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
    expect(isDocumentOlderThan(d.toISOString(), ADDRESS_PROOF_MAX_AGE_DAYS, now)).toBe(false);
  });

  it('91 день — старше', () => {
    const d = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000);
    expect(isDocumentOlderThan(d.toISOString(), ADDRESS_PROOF_MAX_AGE_DAYS, now)).toBe(true);
  });

  it('вчерашний документ — не старше', () => {
    const d = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    expect(isDocumentOlderThan(d.toISOString(), ADDRESS_PROOF_MAX_AGE_DAYS, now)).toBe(false);
  });
});
