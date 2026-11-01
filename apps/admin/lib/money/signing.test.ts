import type { KeyObject } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  generateEd25519KeyPair,
  signMoneyCommand,
  StaticEd25519KeyProvider,
  verifyIncomingCommand,
  verifyMoneyCommand,
  type AcceptancePorts,
} from './signing';
import type { MoneyCommandPayload } from './types';

/**
 * Р-452 · подпись Ed25519 и проверка приёма. Крипто — node:crypto, без нативных
 * аддонов (Р-453). Эти тесты — заодно и ВЕКТОРЫ для терминальной зоны (Rust):
 * та же каноническая нагрузка должна дать ту же подпись/вердикт.
 */

const { privateKey, publicKey } = generateEd25519KeyPair();
const provider = new StaticEd25519KeyProvider(privateKey, publicKey, 'v1');

function payloadAt(issuedAt: string): MoneyCommandPayload {
  return {
    commandId: '11111111-1111-1111-1111-111111111111',
    type: 'adjustment',
    accountId: '22222222-2222-2222-2222-222222222222',
    amount: { amountMinor: '150000', currency: 'USD', scale: 2 },
    initiatorId: '33333333-3333-3333-3333-333333333333',
    basisRef: 'TICKET-42',
    originalCommandId: null,
    initiateApprovalId: '44444444-4444-4444-4444-444444444444',
    secondApprovalId: '55555555-5555-5555-5555-555555555555',
    issuedAt,
    nonce: 'nonce-abc',
  };
}

const NOW = Date.parse('2026-10-31T12:00:00.000Z');

function ports(overrides: Partial<AcceptancePorts> = {}): AcceptancePorts {
  return {
    publicKeyForVersion: (v) => (v === 'v1' ? publicKey : null),
    isNonceFresh: () => true,
    isAuthorActive: () => true,
    basisExists: () => true,
    now: () => NOW,
    ...overrides,
  };
}

beforeEach(() => {
  process.env.MONEY_TIMESTAMP_WINDOW_MS = String(5 * 60 * 1000);
  process.env.MONEY_CLOCK_SKEW_MS = String(60 * 1000);
});
afterEach(() => {
  delete process.env.MONEY_TIMESTAMP_WINDOW_MS;
  delete process.env.MONEY_CLOCK_SKEW_MS;
});

describe('sign → verify round-trip', () => {
  it('валидная подпись проходит проверку', () => {
    const signed = signMoneyCommand(payloadAt(new Date(NOW).toISOString()), provider);
    expect(signed.keyVersion).toBe('v1');
    expect(verifyMoneyCommand(signed, publicKey)).toBe(true);
  });

  it('подмена нагрузки рвёт подпись', () => {
    const signed = signMoneyCommand(payloadAt(new Date(NOW).toISOString()), provider);
    const tampered = {
      ...signed,
      payload: { ...signed.payload, amount: { ...signed.payload.amount, amountMinor: '999999' } },
    };
    expect(verifyMoneyCommand(tampered, publicKey)).toBe(false);
  });

  it('битая подпись → false, не исключение', () => {
    const signed = signMoneyCommand(payloadAt(new Date(NOW).toISOString()), provider);
    expect(verifyMoneyCommand({ ...signed, signature: 'не-base64-??' }, publicKey)).toBe(false);
  });

  it('другой ключ не проверяет', () => {
    const signed = signMoneyCommand(payloadAt(new Date(NOW).toISOString()), provider);
    const other = generateEd25519KeyPair().publicKey as KeyObject;
    expect(verifyMoneyCommand(signed, other)).toBe(false);
  });
});

describe('verifyIncomingCommand — приём (fail-closed)', () => {
  it('всё валидно → ok', () => {
    const signed = signMoneyCommand(payloadAt(new Date(NOW).toISOString()), provider);
    expect(verifyIncomingCommand(signed, ports())).toEqual({ ok: true });
  });

  it('истёкшая метка (старше окна) → expiredTimestamp', () => {
    const old = new Date(NOW - 10 * 60 * 1000).toISOString();
    const signed = signMoneyCommand(payloadAt(old), provider);
    expect(verifyIncomingCommand(signed, ports())).toEqual({ ok: false, reason: 'expiredTimestamp' });
  });

  it('метка из будущего (сверх перекоса) → futureTimestamp', () => {
    const future = new Date(NOW + 10 * 60 * 1000).toISOString();
    const signed = signMoneyCommand(payloadAt(future), provider);
    expect(verifyIncomingCommand(signed, ports())).toEqual({ ok: false, reason: 'futureTimestamp' });
  });

  it('повтор nonce → replayedNonce', () => {
    const signed = signMoneyCommand(payloadAt(new Date(NOW).toISOString()), provider);
    expect(verifyIncomingCommand(signed, ports({ isNonceFresh: () => false }))).toEqual({
      ok: false,
      reason: 'replayedNonce',
    });
  });

  it('неактивный автор → inactiveAuthor', () => {
    const signed = signMoneyCommand(payloadAt(new Date(NOW).toISOString()), provider);
    expect(verifyIncomingCommand(signed, ports({ isAuthorActive: () => false }))).toEqual({
      ok: false,
      reason: 'inactiveAuthor',
    });
  });

  it('нет основания → missingBasis', () => {
    const signed = signMoneyCommand(payloadAt(new Date(NOW).toISOString()), provider);
    expect(verifyIncomingCommand(signed, ports({ basisExists: () => false }))).toEqual({
      ok: false,
      reason: 'missingBasis',
    });
  });

  it('неизвестная версия ключа → unknownKeyVersion', () => {
    const signed = signMoneyCommand(payloadAt(new Date(NOW).toISOString()), provider);
    expect(verifyIncomingCommand(signed, ports({ publicKeyForVersion: () => null }))).toEqual({
      ok: false,
      reason: 'unknownKeyVersion',
    });
  });

  it('валидная версия, но подпись не от того ключа → badSignature', () => {
    const otherPub = generateEd25519KeyPair().publicKey;
    const signed = signMoneyCommand(payloadAt(new Date(NOW).toISOString()), provider);
    expect(verifyIncomingCommand(signed, ports({ publicKeyForVersion: () => otherPub }))).toEqual({
      ok: false,
      reason: 'badSignature',
    });
  });
});
