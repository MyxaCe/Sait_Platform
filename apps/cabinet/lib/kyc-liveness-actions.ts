'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getSessionUser } from './auth/session';
import { isRateLimited } from './rate-limit';
import { getVerificationState } from './kyc';
import { getKycProvider, type LivenessTask } from './kyc-provider';
import type { LivenessFrame } from './kyc-provider/types';
import type { ActionState } from './actions';

export interface SelfieChallengeView {
  id: string;
  code: string;
  tasks: LivenessTask[];
  ttlMs: number;
}

export type StartSelfieResult =
  | { ok: true; challenge: SelfieChallengeView }
  | { ok: false; error: 'unauthorized' | 'rateLimited' | 'alreadyVerified' };

export async function startSelfieChallengeAction(): Promise<StartSelfieResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'unauthorized' };
  if (isRateLimited(`kyc-selfie-start:${user.id}`, 6, 10 * 60_000)) return { ok: false, error: 'rateLimited' };
  if ((await getVerificationState(user.id)) === 'verified') return { ok: false, error: 'alreadyVerified' };

  const c = await getKycProvider().issueLivenessChallenge(user.id);
  return { ok: true, challenge: { id: c.id, code: c.code, tasks: c.tasks, ttlMs: c.ttlMs } };
}

const REJECTION_ERROR = {
  notFound: 'selfieExpired',
  used: 'selfieExpired',
  expired: 'selfieExpired',
  invalidCode: 'selfieInvalid',
  invalidFrames: 'selfieInvalid',
} as const;

export async function submitSelfieCaptureAction(formData: FormData): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { error: 'unauthorized' };
  if (isRateLimited(`kyc-upload:${user.id}`, 10, 60_000)) return { error: 'rateLimited' };

  const files = formData.getAll('frame');
  const elapsed = formData.getAll('elapsed').map((v) => Number(v));
  if (files.length === 0 || files.length !== elapsed.length || !files.every((f) => f instanceof File)) {
    return { error: 'selfieInvalid' };
  }
  const frames: LivenessFrame[] = await Promise.all(
    (files as File[]).map(async (file, i) => ({
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type,
      elapsedMs: elapsed[i]!,
    })),
  );

  const outcome = await getKycProvider().acceptLivenessCapture(user.id, {
    challengeId: String(formData.get('challengeId') ?? ''),
    code: String(formData.get('code') ?? ''),
    frames,
    userAgent: headers().get('user-agent'),
  });
  if (!outcome.ok) return { error: REJECTION_ERROR[outcome.reason] };

  revalidatePath('/profile');
  return { ok: true };
}
