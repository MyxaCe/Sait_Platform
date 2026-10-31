/**
 * Чистые константы и типы KYC — БЕЗ доступа к БД (CAB-KYC).
 *
 * Вынесено отдельно от `lib/kyc.ts` сознательно: форма подачи — клиентский
 * компонент, и ей нужен только перечень видов. Если бы она тянула этот
 * перечень из `lib/kyc.ts` (а тот импортирует `pg` ради чтений), `pg` попал
 * бы в клиентский бандл и сборка падала бы на `node:net`/`tls`. Граница
 * «клиентское/серверное» проходит здесь: этот модуль безопасен для обеих
 * сторон.
 */

/** Виды KYC-документа — закрытый перечень, зеркало CHECK в схеме `kyc_documents`. */
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

/** Состояние проверки — зеркало CHECK в `client_verification`. */
export type VerificationState = 'unverified' | 'pending' | 'verified' | 'rejected';
