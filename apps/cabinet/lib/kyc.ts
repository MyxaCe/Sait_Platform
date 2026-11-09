import { getPool } from './db';
import { isKycDocKind, type KycDocKind, type VerificationState } from './kyc-kinds';

/**
 * KYC-сторона кабинета (CAB-KYC, Р-454 II-1): клиент подаёт свои документы на
 * проверку. Это НАСТОЯЩИЙ приём в объектное хранилище и строки
 * `kyc_documents` / `client_verification` — в отличие от соседней «заглушки»
 * `documents` (локальный диск, до интеграции с CRM).
 *
 * Этот модуль — ЧТЕНИЯ (трогает БД через `pg`, поэтому только серверный); сам
 * приём файла в `kyc-actions.ts`. Константы и типы видов — в `kyc-kinds.ts`
 * (без БД, пригодны и для клиентской формы). Все чтения — по `userId` из
 * СЕССИИ, не из ввода.
 */

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

/** Документы, которые клиент уже подал (метаданные; байты — в хранилище). */
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

/** Текущее состояние проверки клиента или `null`, если строки ещё нет. */
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

/**
 * Гейт KYC на ДЕНЬГИ (подготовка к пополнению/выводу).
 *
 * `true` — только если оператор подтвердил проверку в центре управления
 * (`/kyc`, `client_verification.state = 'verified'`). Любое иное состояние,
 * в том числе отсутствие строки, `pending`, `rejected`,
 * `resubmit_requested`, — `false`: fail-closed, деньги без подтверждённой
 * личности не двигаются.
 *
 * Демо-торговлю этим НЕ гейтим сознательно: демо-счёт не деньги клиента, а
 * воронка до верификации. Вызывать — по `userId` из СЕССИИ, не из ввода.
 */
export async function isKycVerified(
  userId: string,
  db: { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> } = getPool(),
): Promise<boolean> {
  const r = await db.query(`SELECT state FROM client_verification WHERE user_id = $1`, [userId]);
  return r.rows[0]?.state === 'verified';
}
