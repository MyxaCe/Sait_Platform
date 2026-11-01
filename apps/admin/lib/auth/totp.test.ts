import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  generateTotp,
  generateTotpSecret,
  verifyTotp,
} from './totp';

/**
 * ADM-13 · TOTP на чистом `node:crypto` (Р-454 III-3, Р-453 — без нативного).
 *
 * Корректность HMAC/усечения проверяется ОФИЦИАЛЬНЫМИ векторами RFC 6238
 * (SHA1, секрет ASCII "12345678901234567890"): если считалка разойдётся со
 * стандартом, приложение-аутентификатор перестанет совпадать — ловим здесь.
 */

// RFC 6238, Appendix B: тот самый общий секрет, в base32.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('TOTP · векторы RFC 6238 (SHA1, 6 цифр)', () => {
  const vectors: [number, string][] = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ];
  for (const [unixSeconds, expected] of vectors) {
    it(`T=${unixSeconds} → ${expected}`, () => {
      expect(generateTotp(RFC_SECRET, {}, unixSeconds * 1000)).toBe(expected);
    });
  }
});

describe('base32 (RFC 4648)', () => {
  it('encode/decode — обратимы', () => {
    const buf = Buffer.from('12345678901234567890', 'ascii');
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  it('свежий секрет — 160 бит = 32 символа base32', () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/u);
  });
});

describe('verifyTotp · окно дрейфа ±1 (Р-454)', () => {
  const now = 59_000; // counter = 1

  it('текущий код принят', () => {
    expect(verifyTotp(RFC_SECRET, '287082', {}, now)).toBe(true);
  });

  it('код предыдущего шага (−1) принят', () => {
    const prevStep = generateTotp(RFC_SECRET, {}, 29_000); // counter 0
    expect(verifyTotp(RFC_SECRET, prevStep, {}, now)).toBe(true);
  });

  it('код следующего шага (+1) принят', () => {
    const nextStep = generateTotp(RFC_SECRET, {}, 89_000); // counter 2
    expect(verifyTotp(RFC_SECRET, nextStep, {}, now)).toBe(true);
  });

  it('код за пределами окна (+10 шагов) отвергнут', () => {
    const farStep = generateTotp(RFC_SECRET, {}, now + 10 * 30_000); // drift +10, вне ±1
    expect(verifyTotp(RFC_SECRET, farStep, {}, now)).toBe(false);
  });

  it('чужой код отвергнут', () => {
    expect(verifyTotp(RFC_SECRET, '000000', {}, now)).toBe(false);
  });

  it('не та длина / не цифры → false без сравнения', () => {
    expect(verifyTotp(RFC_SECRET, '28708', {}, now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, '2870821', {}, now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, 'abcdef', {}, now)).toBe(false);
    expect(verifyTotp(RFC_SECRET, '', {}, now)).toBe(false);
  });

  it('пробелы вокруг кода допускаются', () => {
    expect(verifyTotp(RFC_SECRET, ' 287 082 ', {}, now)).toBe(true);
  });

  it('битый секрет (не base32) → false, не исключение', () => {
    expect(verifyTotp('не-base32!!!', '287082', {}, now)).toBe(false);
  });
});

describe('provisioning-URI (otpauth://)', () => {
  it('содержит схему, секрет, issuer и параметры', () => {
    const uri = buildOtpauthUri({ secret: RFC_SECRET, accountName: 'super' });
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain(`secret=${RFC_SECRET}`);
    expect(uri).toContain('issuer=');
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});
