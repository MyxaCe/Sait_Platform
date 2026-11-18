import { getPool, type Queryable } from '../db';

export type VerificationState =
  | 'unverified'
  | 'pending'
  | 'verified'
  | 'rejected'
  | 'resubmit_requested';

export const VERIFICATION_STATES: readonly VerificationState[] = [
  'unverified',
  'pending',
  'verified',
  'rejected',
  'resubmit_requested',
];

export type KycDocKind = 'identity' | 'selfie_liveness' | 'address_proof' | 'source_of_funds';

export const ADDRESS_PROOF_MAX_AGE_DAYS = 90;

export function isDocumentOlderThan(
  submittedAt: string,
  days: number,
  now: Date = new Date(),
): boolean {
  const ageMs = now.getTime() - new Date(submittedAt).getTime();
  return ageMs > days * 24 * 60 * 60 * 1000;
}

export const DOC_KIND_LABELS: Record<KycDocKind, string> = {
  identity: 'Паспорт / ID',
  selfie_liveness: 'Селфи с liveness',
  address_proof: 'Подтверждение адреса',
  source_of_funds: 'Источник средств',
};

export interface PendingClient {
  userId: string;
  fullName: string;
  email: string;
  updatedAt: string;
  documentCount: number;
}

export interface KycDocument {
  id: string;
  kind: KycDocKind;
  storageKey: string;
  contentType: string | null;
  submittedAt: string;
}

export interface ClientVerificationCard {
  userId: string;
  fullName: string;
  email: string;
  registeredAt: string;
  state: VerificationState;
  updatedAt: string;
  documents: KycDocument[];
}

function asState(value: unknown): VerificationState {
  if (
    value === 'unverified' ||
    value === 'pending' ||
    value === 'verified' ||
    value === 'rejected' ||
    value === 'resubmit_requested'
  ) {
    return value;
  }
  throw new Error(`client_verification.state вне допустимого множества: ${String(value)}`);
}

function asDocKind(value: unknown): KycDocKind {
  if (
    value === 'identity' ||
    value === 'selfie_liveness' ||
    value === 'address_proof' ||
    value === 'source_of_funds'
  ) {
    return value;
  }
  throw new Error(`kyc_documents.doc_kind вне допустимого множества: ${String(value)}`);
}

export async function listPendingClients(db: Queryable = getPool()): Promise<PendingClient[]> {
  const result = await db.query(
    `SELECT cv.user_id,
            u.full_name,
            u.email,
            cv.updated_at,
            COUNT(d.id) AS document_count
       FROM client_verification cv
       JOIN users u ON u.id = cv.user_id
       LEFT JOIN kyc_documents d ON d.user_id = cv.user_id
      WHERE cv.state = 'pending'
      GROUP BY cv.user_id, u.full_name, u.email, cv.updated_at
      ORDER BY cv.updated_at ASC`,
  );
  return result.rows.map((r) => ({
    userId: r.user_id as string,
    fullName: r.full_name as string,
    email: r.email as string,
    updatedAt: new Date(r.updated_at as string | Date).toISOString(),
    documentCount: Number(r.document_count ?? 0),
  }));
}

export async function getClientVerificationCard(
  userId: string,
  db: Queryable = getPool(),
): Promise<ClientVerificationCard | null> {
  const head = await db.query(
    `SELECT cv.user_id, cv.state, cv.updated_at, u.full_name, u.email, u.created_at
       FROM client_verification cv
       JOIN users u ON u.id = cv.user_id
      WHERE cv.user_id = $1`,
    [userId],
  );
  const row = head.rows[0];
  if (!row) return null;

  const docs = await db.query(
    `SELECT id, doc_kind, storage_key, content_type, submitted_at
       FROM kyc_documents
      WHERE user_id = $1
      ORDER BY submitted_at ASC`,
    [userId],
  );

  return {
    userId: row.user_id as string,
    fullName: row.full_name as string,
    email: row.email as string,
    registeredAt: new Date(row.created_at as string | Date).toISOString(),
    state: asState(row.state),
    updatedAt: new Date(row.updated_at as string | Date).toISOString(),
    documents: docs.rows.map((d) => ({
      id: d.id as string,
      kind: asDocKind(d.doc_kind),
      storageKey: d.storage_key as string,
      contentType: (d.content_type as string | null) ?? null,
      submittedAt: new Date(d.submitted_at as string | Date).toISOString(),
    })),
  };
}
