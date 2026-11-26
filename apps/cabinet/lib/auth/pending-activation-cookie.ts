import { cookies } from 'next/headers';
import {
  decodePendingActivation,
  encodePendingActivation,
  PENDING_ACTIVATION_COOKIE,
  PENDING_ACTIVATION_MAX_AGE,
  type PendingActivation,
} from './pending-activation';

export function setPendingActivation(p: PendingActivation): void {
  cookies().set(PENDING_ACTIVATION_COOKIE, encodePendingActivation(p), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: PENDING_ACTIVATION_MAX_AGE,
  });
}

export function readPendingActivation(): PendingActivation | null {
  return decodePendingActivation(cookies().get(PENDING_ACTIVATION_COOKIE)?.value);
}

export function clearPendingActivation(): void {
  cookies().delete(PENDING_ACTIVATION_COOKIE);
}
