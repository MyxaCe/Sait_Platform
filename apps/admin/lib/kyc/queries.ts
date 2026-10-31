import { getPool, type Queryable } from '../db';

/**
 * Чтения операторской поверхности KYC (ADM-08, Р-451 п.4).
 *
 * Операторский периметр читает из клиентской `users` РОВНО то, что нужно
 * опознать человека в очереди и карточке (id, имя, email, когда
 * зарегистрирован) — не больше (Р-395: оператор ≠ клиент, доступ к `users`
 * только на чтение нужных полей). Пароль, сессии и прочее клиентское сюда не
 * попадают.
 */

/** Четыре состояния из фундамента (1793449440000). Пятого нет (см. миграцию). */
export type VerificationState = 'unverified' | 'pending' | 'verified' | 'rejected';

export const VERIFICATION_STATES: readonly VerificationState[] = [
  'unverified',
  'pending',
  'verified',
  'rejected',
];

/** Виды KYC-документа по Р-451 п.4 (закрытый перечень = CHECK в схеме). */
export type KycDocKind = 'identity' | 'selfie_liveness' | 'address_proof' | 'source_of_funds';

/** Человекочитаемые подписи видов — для карточки оператора. */
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

/** Приводим строку БД к известному состоянию или бросаем (fail-closed). */
function asState(value: unknown): VerificationState {
  if (
    value === 'unverified' ||
    value === 'pending' ||
    value === 'verified' ||
    value === 'rejected'
  ) {
    return value;
  }
  // Неизвестное состояние — не «наверное ок»: строка сломана, не трактуем.
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

/**
 * Очередь клиентов, ждущих решения: ровно те, у кого `state = 'pending'`.
 * Только pending — не `unverified` (ещё не подал) и не терминальные
 * `verified`/`rejected`. Старые сверху — кто дольше ждёт.
 */
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

/**
 * Карточка клиента для решения: его состояние проверки и поданные документы
 * (метаданные + ссылка на хранилище). `null`, если по этому id нет строки
 * `client_verification` (оператор решает только о тех, у кого проверка
 * заведена; просто существующий `users` без проверки сюда не относится).
 */
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
