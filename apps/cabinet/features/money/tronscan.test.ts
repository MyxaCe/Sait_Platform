import { describe, expect, it } from 'vitest';
import { looksLikeTronAddress, looksLikeTxHash, tronscanTxUrl } from './tronscan';

const HASH = 'a'.repeat(32) + 'B'.repeat(32);

describe('ссылка на Tronscan', () => {
  it('формат владельца: https://tronscan.org/#/transaction/<hash>', () => {
    expect(tronscanTxUrl(HASH)).toBe(`https://tronscan.org/#/transaction/${HASH.toLowerCase()}`);
  });
  it('0x и пробелы срезаются', () => {
    expect(tronscanTxUrl(`  0x${HASH} `)).toBe(`https://tronscan.org/#/transaction/${HASH.toLowerCase()}`);
  });
  it('не хэш — ссылки нет', () => {
    expect(tronscanTxUrl('abc')).toBeNull();
    expect(tronscanTxUrl(`${HASH}/../evil`)).toBeNull();
  });
});

describe('подсказки формата на клиенте', () => {
  it('хэш — 64 hex, допускается 0x', () => {
    expect(looksLikeTxHash(HASH)).toBe(true);
    expect(looksLikeTxHash(`0x${HASH}`)).toBe(true);
    expect(looksLikeTxHash(HASH.slice(1))).toBe(false);
    expect(looksLikeTxHash(`${HASH.slice(1)}g`)).toBe(false);
  });
  it('адрес TRON — T + 33 base58', () => {
    expect(looksLikeTronAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe(true);
    expect(looksLikeTronAddress('0x7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')).toBe(false);
    expect(looksLikeTronAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6')).toBe(false);
    expect(looksLikeTronAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj0t')).toBe(false);
  });
});
