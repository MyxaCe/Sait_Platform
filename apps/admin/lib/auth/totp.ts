import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOTP_DEFAULTS = {
  digits: 6,
  period: 30,
  algorithm: 'sha1' as const,
  window: 1,
};

export const TOTP_ISSUER = 'Wholesalefy Admin';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/u, '').replace(/\s+/gu, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('base32: недопустимый символ');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(randomBytes(byteLength));
}

function hotp(secret: Buffer, counter: number, digits: number, algorithm: string): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm, secret).update(counterBuf).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

export interface TotpOptions {
  digits?: number;
  period?: number;
  algorithm?: 'sha1' | 'sha256' | 'sha512';
}

export function generateTotp(
  secretBase32: string,
  options: TotpOptions = {},
  now: number = Date.now(),
): string {
  const { digits = TOTP_DEFAULTS.digits, period = TOTP_DEFAULTS.period, algorithm = TOTP_DEFAULTS.algorithm } =
    options;
  const counter = Math.floor(now / 1000 / period);
  return hotp(base32Decode(secretBase32), counter, digits, algorithm);
}

function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function verifyTotp(
  secretBase32: string,
  token: string,
  options: TotpOptions & { window?: number } = {},
  now: number = Date.now(),
): boolean {
  const {
    digits = TOTP_DEFAULTS.digits,
    period = TOTP_DEFAULTS.period,
    algorithm = TOTP_DEFAULTS.algorithm,
    window = TOTP_DEFAULTS.window,
  } = options;

  const normalized = token.replace(/\s+/gu, '');
  if (normalized.length !== digits || !/^\d+$/u.test(normalized)) return false;

  let secret: Buffer;
  try {
    secret = base32Decode(secretBase32);
  } catch {
    return false;
  }

  const counter = Math.floor(now / 1000 / period);
  for (let drift = -window; drift <= window; drift += 1) {
    const candidateCounter = counter + drift;
    if (candidateCounter < 0) continue;
    if (constantTimeEqual(hotp(secret, candidateCounter, digits, algorithm), normalized)) {
      return true;
    }
  }
  return false;
}

export function buildOtpauthUri(params: {
  secret: string;
  accountName: string;
  issuer?: string;
  digits?: number;
  period?: number;
  algorithm?: string;
}): string {
  const {
    secret,
    accountName,
    issuer = TOTP_ISSUER,
    digits = TOTP_DEFAULTS.digits,
    period = TOTP_DEFAULTS.period,
    algorithm = TOTP_DEFAULTS.algorithm,
  } = params;
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const query = [
    `secret=${secret}`,
    `issuer=${encodeURIComponent(issuer)}`,
    `algorithm=${algorithm.toUpperCase()}`,
    `digits=${digits}`,
    `period=${period}`,
  ].join('&');
  return `otpauth://totp/${label}?${query}`;
}
