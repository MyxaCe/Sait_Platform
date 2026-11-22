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
  selfie_liveness: 'Селфи с камеры',
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

export type LivenessTaskKind = 'face_front' | 'turn_left' | 'turn_right' | 'show_fingers' | 'hold_document';

export interface LivenessTask {
  kind: LivenessTaskKind;
  count?: number;
}

export interface SelfieFrame {
  index: number;
  capturedAt: string;
}

export interface SelfieCapture {
  provider: string;
  code: string;
  tasks: LivenessTask[];
  issuedAt: string;
  expiresAt: string;
  usedAt: string | null;
  userAgent: string | null;
  frames: SelfieFrame[];
}

export interface KycDocument {
  id: string;
  kind: KycDocKind;
  storageKey: string;
  contentType: string | null;
  submittedAt: string;
  capture: SelfieCapture | null;
}

const TASK_KINDS: readonly string[] = ['face_front', 'turn_left', 'turn_right', 'show_fingers', 'hold_document'];

const iso = (v: unknown): string => new Date(v as string | Date).toISOString();

function parseJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

export function toSelfieCapture(row: Record<string, unknown>): SelfieCapture | null {
  if (!row.challenge_code) return null;
  const rawTasks = parseJson(row.challenge_tasks);
  const tasks: LivenessTask[] = Array.isArray(rawTasks)
    ? rawTasks.flatMap((t) =>
        t && typeof t === 'object' && TASK_KINDS.includes((t as { kind?: string }).kind ?? '')
          ? [
              typeof (t as { count?: unknown }).count === 'number'
                ? { kind: (t as LivenessTask).kind, count: (t as { count: number }).count }
                : { kind: (t as LivenessTask).kind },
            ]
          : [],
      )
    : [];
  const rawFrames = parseJson(row.frames);
  const frames: SelfieFrame[] = Array.isArray(rawFrames)
    ? rawFrames.map((f) => ({ index: Number((f as { i: unknown }).i), capturedAt: iso((f as { at: unknown }).at) }))
    : [];
  return {
    provider: String(row.challenge_provider ?? 'manual'),
    code: String(row.challenge_code),
    tasks,
    issuedAt: iso(row.challenge_issued_at),
    expiresAt: iso(row.challenge_expires_at),
    usedAt: row.challenge_used_at ? iso(row.challenge_used_at) : null,
    userAgent: (row.challenge_user_agent as string | null) ?? null,
    frames,
  };
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
    `SELECT d.id, d.doc_kind, d.storage_key, d.content_type, d.submitted_at,
            c.provider AS challenge_provider, c.code AS challenge_code, c.tasks AS challenge_tasks,
            c.issued_at AS challenge_issued_at, c.expires_at AS challenge_expires_at,
            c.used_at AS challenge_used_at, c.user_agent AS challenge_user_agent,
            (SELECT COALESCE(json_agg(json_build_object('i', f.frame_index, 'at', f.captured_at) ORDER BY f.frame_index), '[]'::json)
               FROM kyc_document_frames f WHERE f.document_id = d.id) AS frames
       FROM kyc_documents d
       LEFT JOIN kyc_liveness_challenges c ON c.document_id = d.id
      WHERE d.user_id = $1
      ORDER BY d.submitted_at ASC`,
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
      capture: toSelfieCapture(d),
    })),
  };
}
