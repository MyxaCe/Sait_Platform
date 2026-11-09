/**
 * Суммы USDT ↔ центы счёта. Только целочисленная арифметика (BigInt):
 * деньги реальные, плавающая точка здесь — источник копеечных расхождений.
 *
 * USDT TRC20 — 6 знаков после запятой; счёт в терминале — центы USD
 * (1 USDT = 100 центов, курс 1:1 — решение владельца). Значит 1 цент =
 * 10 000 сырых единиц токена.
 *
 * **Дробь меньше цента отбрасывается ВНИЗ и записывается** (`dustRaw`):
 * зачислить больше, чем пришло, нельзя; округлить вверх — значит
 * доплатить из кармана владельца. Остаток остаётся на кошельке биржи и
 * виден в заявке.
 */

export const USDT_DECIMALS = 6;
const RAW_PER_CENT = 10n ** BigInt(USDT_DECIMALS - 2); // 10 000

export interface RawToCents {
  cents: bigint;
  /** Отброшенная дробь меньше цента, в сырых единицах токена. */
  dustRaw: bigint;
}

/** Сырые единицы USDT (строка из сети или bigint) → центы + отброшенный остаток. */
export function usdtRawToCents(raw: bigint | string): RawToCents {
  const value = typeof raw === 'bigint' ? raw : parseRaw(raw);
  if (value < 0n) throw new Error('отрицательная сумма токена');
  return { cents: value / RAW_PER_CENT, dustRaw: value % RAW_PER_CENT };
}

/** Центы → сырые единицы USDT (для сверки выплаты: сумма в сети обязана совпасть). */
export function centsToUsdtRaw(cents: bigint | number): bigint {
  const c = typeof cents === 'bigint' ? cents : BigInt(cents);
  return c * RAW_PER_CENT;
}

function parseRaw(raw: string): bigint {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) throw new Error(`сумма токена не целое число: ${raw}`);
  return BigInt(trimmed);
}

export type ParsedAmount =
  | { ok: true; cents: number }
  | { ok: false; reason: 'empty' | 'invalid' | 'tooPrecise' | 'notPositive' | 'tooLarge' };

/** Предел одной операции (защита от опечатки «лишние нули»): 10 млн USDT. */
const MAX_CENTS = 1_000_000_000n;

/**
 * Ввод суммы человеком («12», «12.5», «12,50») → центы. Больше двух знаков
 * после запятой — ошибка, а не округление: человек должен видеть, сколько
 * уйдёт, ровно.
 */
export function parseUsdtAmountToCents(input: string): ParsedAmount {
  const s = input.trim().replace(/\s+/g, '').replace(',', '.');
  if (s === '') return { ok: false, reason: 'empty' };
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return { ok: false, reason: 'invalid' };
  const frac = m[2] ?? '';
  if (frac.length > 2) return { ok: false, reason: 'tooPrecise' };
  const cents = BigInt(m[1]!) * 100n + BigInt((frac + '00').slice(0, 2));
  if (cents <= 0n) return { ok: false, reason: 'notPositive' };
  if (cents > MAX_CENTS) return { ok: false, reason: 'tooLarge' };
  return { ok: true, cents: Number(cents) };
}

/** Центы → «12.34» (без символа валюты; для подписей «USDT»). */
export function formatCentsPlain(cents: number | bigint): string {
  const c = typeof cents === 'bigint' ? cents : BigInt(Math.trunc(cents));
  const neg = c < 0n;
  const abs = neg ? -c : c;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${neg ? '−' : ''}${whole}.${frac}`;
}

/** Сырые единицы USDT → «12.345678» (точно, для показа сумм из сети). */
export function formatUsdtRaw(raw: bigint | string): string {
  const v = typeof raw === 'bigint' ? raw : parseRaw(raw);
  const base = 10n ** BigInt(USDT_DECIMALS);
  const frac = (v % base).toString().padStart(USDT_DECIMALS, '0').replace(/0+$/, '');
  return `${(v / base).toString()}${frac ? `.${frac}` : ''}`;
}
