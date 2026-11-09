import { createHash } from 'node:crypto';

/**
 * Адреса и хэши сети TRON. Без сетевых вызовов — чистые функции.
 *
 * Адрес TRON: base58check от 25 байт = префикс 0x41 + 20 байт адреса +
 * 4 байта контрольной суммы (первые 4 байта sha256(sha256(21 байт))). В
 * строковом виде всегда начинается с «T» и имеет 34 символа. Проверяем
 * именно контрольную сумму, а не регэксп: опечатка в одном символе адреса
 * вывода — это деньги, отправленные в никуда.
 */

/** Официальный контракт USDT TRC20 (основная сеть). */
export const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP = new Map([...ALPHABET].map((c, i) => [c, BigInt(i)]));

function sha256(data: Uint8Array): Uint8Array {
  return createHash('sha256').update(data).digest();
}

function base58Decode(s: string): Uint8Array | null {
  let n = 0n;
  for (const ch of s) {
    const v = ALPHABET_MAP.get(ch);
    if (v === undefined) return null;
    n = n * 58n + v;
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const ch of s) {
    if (ch !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

function checksum(payload: Uint8Array): Uint8Array {
  return sha256(sha256(payload)).subarray(0, 4);
}

/** Адрес TRON валиден: 34 символа base58, префикс 0x41 («T»), верная контрольная сумма. */
export function isValidTronAddress(address: string): boolean {
  if (typeof address !== 'string' || address.length !== 34 || address[0] !== 'T') return false;
  const bytes = base58Decode(address);
  if (!bytes || bytes.length !== 25 || bytes[0] !== 0x41) return false;
  const sum = checksum(bytes.subarray(0, 21));
  return sum.every((b, i) => b === bytes[21 + i]);
}

/**
 * Hex-адрес → base58. Принимает 21 байт с префиксом 41 («41…», 42 hex) или
 * 20 байт без префикса (40 hex, так приходят адреса в логах событий EVM).
 */
export function tronHexToBase58(hex: string): string {
  let h = hex.toLowerCase().replace(/^0x/, '');
  if (h.length === 40) h = `41${h}`;
  if (!/^41[0-9a-f]{40}$/.test(h)) throw new Error(`не адрес TRON в hex: ${hex}`);
  const payload = Uint8Array.from(Buffer.from(h, 'hex'));
  const full = new Uint8Array(25);
  full.set(payload, 0);
  full.set(checksum(payload), 21);
  return base58Encode(full);
}

/** Тема события (32 байта hex) → адрес base58 (последние 20 байт). */
export function topicToTronAddress(topic: string): string {
  const h = topic.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error(`не тема события: ${topic}`);
  return tronHexToBase58(h.slice(24));
}

/** Хэш транзакции: 64 hex, без 0x, в нижнем регистре; иначе null. */
export function normalizeTxHash(input: string): string | null {
  const h = input.trim().toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]{64}$/.test(h) ? h : null;
}

/** Сигнатура события ERC20/TRC20 Transfer(address,address,uint256). */
export const TRANSFER_TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
