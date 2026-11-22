export const KYC_DOC_KINDS = [
  'identity',
  'selfie_liveness',
  'address_proof',
  'source_of_funds',
] as const;

export type KycDocKind = (typeof KYC_DOC_KINDS)[number];

export function isKycDocKind(value: unknown): value is KycDocKind {
  return typeof value === 'string' && (KYC_DOC_KINDS as readonly string[]).includes(value);
}

export const CAMERA_ONLY_KYC_KINDS: readonly KycDocKind[] = ['selfie_liveness'];

export const KYC_STEPS = ['identity', 'address_proof', 'selfie_liveness'] as const;

export type KycStep = (typeof KYC_STEPS)[number];

export type VerificationState = 'unverified' | 'pending' | 'verified' | 'rejected' | 'resubmit_requested';
