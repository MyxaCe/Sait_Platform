import type { PoolLike } from '@broker/money';
import { checkSecondFactor, isTwoFactorEnabled, twoFactorKey } from '@broker/support';
import { getPool } from './db';

export const TWO_FACTOR_COOKIE = 'cabinet_2fa';

export type TwoFactorError = 'twoFactorRequired' | 'twoFactorInvalid' | 'twoFactorLocked' | 'twoFactorUnavailable';

export function twoFactorPool(): PoolLike {
  return getPool() as unknown as PoolLike;
}

export function cabinetTwoFactorKey(): Buffer | null {
  return twoFactorKey(process.env.CABINET_TOTP_KEY);
}

export function codeError(reason: 'invalidCode' | 'locked' | 'unavailable' | 'notEnabled' | 'expired'): TwoFactorError {
  if (reason === 'locked') return 'twoFactorLocked';
  if (reason === 'unavailable') return 'twoFactorUnavailable';
  return 'twoFactorInvalid';
}

export async function secondFactorGate(
  userId: string,
  code: FormDataEntryValue | null,
): Promise<{ ok: true } | { ok: false; error: TwoFactorError }> {
  const pool = twoFactorPool();
  if (!(await isTwoFactorEnabled(pool, userId))) return { ok: true };
  const value = typeof code === 'string' ? code.trim() : '';
  if (!value) return { ok: false, error: 'twoFactorRequired' };
  const r = await checkSecondFactor(pool, { userId, code: value, key: cabinetTwoFactorKey() });
  if (r.ok || r.reason === 'notEnabled') return { ok: true };
  return { ok: false, error: codeError(r.reason) };
}
