/**
 * Разбор суммы на КЛИЕНТЕ (подсказка до отправки) — зеркало
 * `parseUsdtAmountToCents` из @broker/money: тот модуль тянет за собой БД и в
 * браузерный бандл не идёт. Совпадение исходов закреплено тестом
 * (`amount.test.ts`); окончательный разбор всё равно делает сервер.
 */
export type ClientAmount =
  | { ok: true; cents: number }
  | { ok: false; reason: 'empty' | 'invalid' | 'tooPrecise' | 'notPositive' | 'tooLarge' };

const MAX_CENTS = 1_000_000_000n; // как на сервере (10 млн USDT)

export function parseAmount(input: string): ClientAmount {
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
