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

export type VerificationState = 'unverified' | 'pending' | 'verified' | 'rejected';
