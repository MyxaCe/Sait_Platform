import { getPool } from './db';
import { isKycDocKind, type KycDocKind, type VerificationState } from './kyc-kinds';

export {
  KYC_DOC_KINDS,
  isKycDocKind,
  type KycDocKind,
  type VerificationState,
} from './kyc-kinds';

export interface SubmittedKycDocument {
  id: string;
  kind: KycDocKind;
  contentType: string | null;
  submittedAt: Date;
}

export async function listKycDocuments(userId: string): Promise<SubmittedKycDocument[]> {
  const r = await getPool().query(
    `SELECT id, doc_kind, content_type, submitted_at
       FROM kyc_documents WHERE user_id = $1 ORDER BY submitted_at DESC`,
    [userId],
  );
  return r.rows
    .filter((row) => isKycDocKind(row.doc_kind))
    .map((row) => ({
      id: row.id as string,
      kind: row.doc_kind as KycDocKind,
      contentType: (row.content_type as string | null) ?? null,
      submittedAt: row.submitted_at as Date,
    }));
}

export async function getVerificationState(userId: string): Promise<VerificationState | null> {
  const r = await getPool().query(
    `SELECT state FROM client_verification WHERE user_id = $1`,
    [userId],
  );
  const state = r.rows[0]?.state as string | undefined;
  if (state === 'unverified' || state === 'pending' || state === 'verified' || state === 'rejected') {
    return state;
  }
  return null;
}

export async function isKycVerified(
  userId: string,
  db: { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> } = getPool(),
): Promise<boolean> {
  const r = await db.query(`SELECT state FROM client_verification WHERE user_id = $1`, [userId]);
  return r.rows[0]?.state === 'verified';
}
