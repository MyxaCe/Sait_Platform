'use server';

import QRCode from 'qrcode';
import { revalidatePath } from 'next/cache';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  beginTwoFactorEnrollment,
  buildOtpauthUri,
  confirmTwoFactorEnrollment,
  disableTwoFactor,
  regenerateRecoveryCodes,
} from '@broker/support';
import { getSessionUser } from './auth/session';
import { getChromeBrand, resolveBrandName } from './chrome';
import { isRateLimited } from './rate-limit';
import { cabinetTwoFactorKey, codeError, twoFactorPool } from './two-factor';

export interface TwoFactorState {
  ok?: boolean;
  error?: string;
  setup?: { secret: string; qr: string };
  recoveryCodes?: string[];
  disabled?: boolean;
}

function done() {
  revalidatePath('/profile');
}

export async function beginTwoFactorAction(): Promise<TwoFactorState> {
  const user = await getSessionUser();
  if (!user) return { error: 'unauthorized' };
  if (isRateLimited(`2fa-begin:${user.id}`, 10, 60_000)) return { error: 'rateLimited' };
  const r = await beginTwoFactorEnrollment(twoFactorPool(), { userId: user.id, key: cabinetTwoFactorKey() });
  if (!r.ok) return { error: r.reason === 'unavailable' ? 'twoFactorUnavailable' : 'twoFactorAlreadyEnabled' };
  const locale = await getLocale();
  const t = await getTranslations('twoFactor');
  const issuer = resolveBrandName(await getChromeBrand(locale), t('issuerFallback'));
  const uri = buildOtpauthUri({ secret: r.secret, accountName: user.email, issuer });
  const qr = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { setup: { secret: r.secret, qr } };
}

export async function confirmTwoFactorAction(prev: TwoFactorState, fd: FormData): Promise<TwoFactorState> {
  const user = await getSessionUser();
  if (!user) return { error: 'unauthorized' };
  if (isRateLimited(`2fa:${user.id}`, 10, 60_000)) return { ...prev, error: 'rateLimited' };
  const r = await confirmTwoFactorEnrollment(twoFactorPool(), {
    userId: user.id,
    code: String(fd.get('code') ?? ''),
    key: cabinetTwoFactorKey(),
  });
  if (!r.ok) {
    if (r.reason === 'expired') return { error: 'twoFactorSetupExpired' };
    return { ...prev, error: codeError(r.reason) };
  }
  done();
  return { ok: true, recoveryCodes: r.recoveryCodes };
}

export async function disableTwoFactorAction(_prev: TwoFactorState, fd: FormData): Promise<TwoFactorState> {
  const user = await getSessionUser();
  if (!user) return { error: 'unauthorized' };
  if (isRateLimited(`2fa:${user.id}`, 10, 60_000)) return { error: 'rateLimited' };
  const r = await disableTwoFactor(twoFactorPool(), {
    userId: user.id,
    code: String(fd.get('code') ?? ''),
    key: cabinetTwoFactorKey(),
  });
  if (!r.ok) return { error: codeError(r.reason) };
  done();
  return { ok: true, disabled: true };
}

export async function regenerateRecoveryCodesAction(_prev: TwoFactorState, fd: FormData): Promise<TwoFactorState> {
  const user = await getSessionUser();
  if (!user) return { error: 'unauthorized' };
  if (isRateLimited(`2fa:${user.id}`, 10, 60_000)) return { error: 'rateLimited' };
  const r = await regenerateRecoveryCodes(twoFactorPool(), {
    userId: user.id,
    code: String(fd.get('code') ?? ''),
    key: cabinetTwoFactorKey(),
  });
  if (!r.ok) return { error: codeError(r.reason) };
  done();
  return { ok: true, recoveryCodes: r.recoveryCodes };
}
