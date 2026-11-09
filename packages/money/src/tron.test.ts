import { describe, expect, it } from 'vitest';
import {
  isValidTronAddress,
  normalizeTxHash,
  topicToTronAddress,
  tronHexToBase58,
  USDT_TRC20_CONTRACT,
} from './tron';

const USDT_HEX = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c';

describe('адрес TRON (base58check)', () => {
  it('настоящий адрес (контракт USDT) валиден', () => {
    expect(isValidTronAddress(USDT_TRC20_CONTRACT)).toBe(true);
  });

  it('опечатка в одном символе ловится контрольной суммой', () => {
    const typo = USDT_TRC20_CONTRACT.slice(0, 10) + 'X' + USDT_TRC20_CONTRACT.slice(11);
    expect(typo).toHaveLength(34);
    expect(isValidTronAddress(typo)).toBe(false);
  });

  it.each([
    '',
    'T',
    '0xa614f803b6fd780986a42c78ec9c7f77e6ded13c',
    'R7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6tT', // не с T
    'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6', // 33 символа
    'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj60', // 0 не из алфавита
    '1BoatSLRHtKNngkdXEeobR76b53LETtpyT', // bitcoin
  ])('%s — невалиден', (addr) => {
    expect(isValidTronAddress(addr)).toBe(false);
  });

  it('hex → base58: c префиксом 41 и без него', () => {
    expect(tronHexToBase58(USDT_HEX)).toBe(USDT_TRC20_CONTRACT);
    expect(tronHexToBase58(USDT_HEX.slice(2))).toBe(USDT_TRC20_CONTRACT);
  });

  it('тема события (32 байта) → адрес', () => {
    const topic = '000000000000000000000000' + USDT_HEX.slice(2);
    expect(topicToTronAddress(topic)).toBe(USDT_TRC20_CONTRACT);
  });
});

describe('хэш транзакции', () => {
  const h = 'a'.repeat(64);
  it('нормализуется: регистр, 0x, пробелы', () => {
    expect(normalizeTxHash(`  0x${h.toUpperCase()} `)).toBe(h);
  });
  it('не 64 hex — null', () => {
    expect(normalizeTxHash('abc')).toBeNull();
    expect(normalizeTxHash('g'.repeat(64))).toBeNull();
  });
});

describe('isUsableExchangeAddress — кошелёк, а не контракт', async () => {
  const { isUsableExchangeAddress, USDT_TRC20_CONTRACT } = await import('./tron');
  it('адрес контракта USDT валиден по формату, но кошельком биржи быть не может', () => {
    expect(isUsableExchangeAddress(USDT_TRC20_CONTRACT)).toBe(false);
  });
  it('обычный кошелёк годится', () => {
    expect(isUsableExchangeAddress('TC2u7Xufdkt5qiAVYuv23TxdKRadC5syEz')).toBe(true);
  });
  it('мусор — нет', () => {
    expect(isUsableExchangeAddress('Tnotanaddress')).toBe(false);
  });
});
