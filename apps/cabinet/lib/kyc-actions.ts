'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireTenantSlug } from '@broker/tenant';
import { buildKycObjectKey, putObject } from '@broker/storage';
import { getPool } from './db';
import { getSessionUser } from './auth/session';
import { isRateLimited } from './rate-limit';
import { CAMERA_ONLY_KYC_KINDS, isKycDocKind } from './kyc-kinds';
import type { ActionState } from './actions';
import { MAX_DOC_BYTES } from '@/upload-limits.mjs';

const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);

export async function submitKycDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { error: 'unauthorized' };
  if (isRateLimited(`kyc-upload:${user.id}`, 10, 60_000)) return { error: 'rateLimited' };

  const kind = String(formData.get('kind') ?? '');
  if (!isKycDocKind(kind)) return { error: 'invalidRequest' };
  if (CAMERA_ONLY_KYC_KINDS.includes(kind)) return { error: 'selfieCameraOnly' };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { fieldErrors: { file: 'required' } };
  }
  if (!ALLOWED_MIME.has(file.type)) return { fieldErrors: { file: 'unsupportedFormat' } };
  if (file.size > MAX_DOC_BYTES) return { fieldErrors: { file: 'fileTooLarge' } };

  const tenant = requireTenantSlug(process.env.SITE_SLUG, 'приём KYC-документа в кабинете');
  const uuid = randomUUID();
  const storageKey = buildKycObjectKey({ tenant, client: user.id, docKind: kind, uuid });

  await putObject({
    key: storageKey,
    body: Buffer.from(await file.arrayBuffer()),
    contentType: file.type,
  });

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO kyc_documents (id, user_id, doc_kind, storage_key, content_type)
       VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), user.id, kind, storageKey, file.type],
    );
    await client.query(
      `INSERT INTO client_verification (user_id, state, updated_at)
       VALUES ($1, 'pending', now())
       ON CONFLICT (user_id) DO UPDATE SET state = 'pending', updated_at = now()`,
      [user.id],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  revalidatePath('/verification');
  revalidatePath('/profile');
  return { ok: true };
}
