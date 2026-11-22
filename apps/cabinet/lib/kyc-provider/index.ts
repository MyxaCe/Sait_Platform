import { buildKycObjectKey, putObject } from '@broker/storage';
import { requireTenantSlug } from '@broker/tenant';
import type { PoolLike } from '@broker/money';
import { MAX_DOC_BYTES } from '@/upload-limits.mjs';
import { getPool } from '../db';
import { createManualKycProvider } from './manual';
import type { KycProvider } from './types';

export type { KycProvider, LivenessOutcome, LivenessTask, LivenessTaskKind } from './types';

const PROVIDERS: Record<string, () => KycProvider> = {
  manual: () =>
    createManualKycProvider({
      db: getPool() as unknown as PoolLike,
      put: (input) => putObject(input),
      maxTotalBytes: MAX_DOC_BYTES,
      objectKey: (userId, uuid) =>
        buildKycObjectKey({
          tenant: requireTenantSlug(process.env.SITE_SLUG, 'селфи с камеры в кабинете'),
          client: userId,
          docKind: 'selfie_liveness',
          uuid,
        }),
    }),
};

export function getKycProvider(): KycProvider {
  const id = process.env.KYC_PROVIDER?.trim() || 'manual';
  const make = PROVIDERS[id];
  if (!make) throw new Error(`KYC-провайдер «${id}» не подключён`);
  return make();
}
