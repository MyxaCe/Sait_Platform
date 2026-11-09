import { getPool, type Queryable } from '../db';
import {
  asSort,
  asState,
  CLIENT_SORTS,
  type ClientSort,
  type KycDocKind,
  type VerificationState,
} from './verification-state';

/**
 * Чтения операторской поверхности «Клиенты» (ADM-02, Р-395).
 *
 * Реестр и карточка читают из клиентской `users` только то, что нужно опознать
 * человека и оценить его состояние управления (проверка + блокировка) — не
 * больше (Р-395: оператор ≠ клиент). Пароль/токены сессий сюда не попадают
 * (у сессии показываем только метаданные: когда, откуда, до когда).
 *
 * Чтение НЕ журналируется (§3.1 дизайна): объём шума. Журналируются только
 * действия, меняющие состояние (блок/разблок — см. `block.ts`).
 */

export type { KycDocKind, VerificationState };
// Переэкспорт для вызывающих, которым хватает серверного модуля (напр. page.tsx).
export { asSort, CLIENT_SORTS, type ClientSort };

const SORT_SQL: Record<ClientSort, string> = {
  registered_desc: 'u.created_at DESC',
  registered_asc: 'u.created_at ASC',
  name_asc: 'u.full_name ASC',
  // Активность = последний вход; кто никогда не входил — в конце.
  activity_desc: 'u.last_login_at DESC NULLS LAST',
};

/** Фильтр по состоянию верификации: любое из состояний либо «все». */
export type StateFilter = VerificationState | 'all';

export interface ClientsQuery {
  /** Поиск по имени/email/id (подстрока, регистронезависимо). */
  search?: string;
  state?: StateFilter;
  sort?: ClientSort;
}

export interface ClientRow {
  userId: string;
  fullName: string;
  email: string;
  registeredAt: string;
  lastLoginAt: string | null;
  state: VerificationState;
  blocked: boolean;
  /**
   * Баланс демо-счёта из проекции торговли (`demo_accounts`, минорные
   * единицы). `null` — счёт ещё не открыт терминалом.
   */
  balanceCents: number | null;
  currency: string | null;
}

/**
 * Реестр клиентов (§3.1). Все клиенты из `users`; состояние проверки и флаг
 * блокировки подтягиваются LEFT JOIN-ом (нет строки проверки → `unverified`,
 * нет строки блокировки → не заблокирован). Поиск/фильтр/сортировка — в SQL;
 * сортировка выбирается из whitelist, а не склеивается из пользовательского
 * текста.
 */
export async function listClients(
  query: ClientsQuery = {},
  db: Queryable = getPool(),
): Promise<ClientRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];

  const search = query.search?.trim();
  if (search) {
    params.push(`%${search}%`);
    const like = `$${params.length}`;
    // id сравниваем как текст — оператор может искать по фрагменту UUID.
    where.push(`(u.full_name ILIKE ${like} OR u.email ILIKE ${like} OR u.id::text ILIKE ${like})`);
  }

  if (query.state && query.state !== 'all') {
    params.push(query.state);
    // COALESCE: отсутствие строки проверки читается как 'unverified'.
    where.push(`COALESCE(cv.state, 'unverified') = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = SORT_SQL[asSort(query.sort)];

  const result = await db.query(
    `SELECT u.id,
            u.full_name,
            u.email,
            u.created_at,
            u.last_login_at,
            COALESCE(cv.state, 'unverified') AS state,
            COALESCE(cb.blocked, false) AS blocked,
            da.balance_cents,
            da.currency
       FROM users u
       LEFT JOIN client_verification cv ON cv.user_id = u.id
       LEFT JOIN client_blocks cb ON cb.user_id = u.id
       LEFT JOIN demo_accounts da ON da.user_id = u.id
       ${whereSql}
      ORDER BY ${orderSql}
      LIMIT 500`,
    params,
  );

  return result.rows.map((r) => ({
    userId: r.id as string,
    fullName: r.full_name as string,
    email: r.email as string,
    registeredAt: new Date(r.created_at as string | Date).toISOString(),
    lastLoginAt: r.last_login_at ? new Date(r.last_login_at as string | Date).toISOString() : null,
    state: asState(r.state),
    blocked: Boolean(r.blocked),
    balanceCents:
      r.balance_cents === null || r.balance_cents === undefined ? null : Number(r.balance_cents),
    currency: (r.currency as string | null) ?? null,
  }));
}

export interface ClientDocument {
  id: string;
  kind: KycDocKind;
  storageKey: string;
  contentType: string | null;
  submittedAt: string;
}

export interface ClientSession {
  id: string;
  createdAt: string;
  expiresAt: string;
  ip: string | null;
  userAgent: string | null;
}

export interface ClientJournalEntry {
  seq: number;
  occurredAt: string;
  action: string;
  operatorName: string | null;
  operatorLogin: string | null;
  payload: Record<string, unknown>;
  prevHash: string | null;
  entryHash: string;
}

export interface ClientBlockState {
  blocked: boolean;
  reason: string | null;
  updatedAt: string | null;
  blockedByName: string | null;
}

export interface ClientCard {
  userId: string;
  fullName: string;
  email: string;
  locale: string;
  registeredAt: string;
  lastLoginAt: string | null;
  emailVerifiedAt: string | null;
  state: VerificationState;
  verificationUpdatedAt: string | null;
  block: ClientBlockState;
  documents: ClientDocument[];
  sessions: ClientSession[];
  journal: ClientJournalEntry[];
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
 * Досье клиента (§3.2): профиль, состояние проверки, состояние блокировки,
 * документы (метаданные + ключ хранилища для превью), активные сессии и
 * журнальная лента ровно по этому субъекту (`subject_kind='client'`).
 * `null`, если такого `users` нет.
 */
export async function getClientCard(
  userId: string,
  db: Queryable = getPool(),
): Promise<ClientCard | null> {
  const head = await db.query(
    `SELECT u.id,
            u.full_name,
            u.email,
            u.locale,
            u.created_at,
            u.last_login_at,
            u.email_verified_at,
            cv.state,
            cv.updated_at AS verification_updated_at,
            cb.blocked,
            cb.reason AS block_reason,
            cb.updated_at AS block_updated_at,
            ob.display_name AS blocked_by_name
       FROM users u
       LEFT JOIN client_verification cv ON cv.user_id = u.id
       LEFT JOIN client_blocks cb ON cb.user_id = u.id
       LEFT JOIN operators ob ON ob.id = cb.blocked_by
      WHERE u.id = $1`,
    [userId],
  );
  const row = head.rows[0];
  if (!row) return null;

  const [docs, sessions, journal] = await Promise.all([
    db.query(
      `SELECT id, doc_kind, storage_key, content_type, submitted_at
         FROM kyc_documents
        WHERE user_id = $1
        ORDER BY submitted_at ASC`,
      [userId],
    ),
    db.query(
      `SELECT id, created_at, expires_at, ip, user_agent
         FROM sessions
        WHERE user_id = $1 AND expires_at > now()
        ORDER BY created_at DESC`,
      [userId],
    ),
    db.query(
      `SELECT j.seq, j.occurred_at, j.action, j.payload, j.prev_hash, j.entry_hash,
              o.display_name AS operator_name, o.login AS operator_login
         FROM admin_action_journal j
         LEFT JOIN operators o ON o.id = j.operator_id
        WHERE j.subject_kind = 'client' AND j.subject_id = $1
        ORDER BY j.seq DESC`,
      [userId],
    ),
  ]);

  const blocked = Boolean(row.blocked);

  return {
    userId: row.id as string,
    fullName: row.full_name as string,
    email: row.email as string,
    locale: (row.locale as string) ?? 'ru',
    registeredAt: new Date(row.created_at as string | Date).toISOString(),
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at as string | Date).toISOString() : null,
    emailVerifiedAt: row.email_verified_at
      ? new Date(row.email_verified_at as string | Date).toISOString()
      : null,
    // Нет строки проверки — клиент ещё не заводил верификацию: 'unverified'.
    state: asState(row.state ?? 'unverified'),
    verificationUpdatedAt: row.verification_updated_at
      ? new Date(row.verification_updated_at as string | Date).toISOString()
      : null,
    block: {
      blocked,
      reason: (row.block_reason as string | null) ?? null,
      updatedAt: row.block_updated_at
        ? new Date(row.block_updated_at as string | Date).toISOString()
        : null,
      blockedByName: (row.blocked_by_name as string | null) ?? null,
    },
    documents: docs.rows.map((d) => ({
      id: d.id as string,
      kind: asDocKind(d.doc_kind),
      storageKey: d.storage_key as string,
      contentType: (d.content_type as string | null) ?? null,
      submittedAt: new Date(d.submitted_at as string | Date).toISOString(),
    })),
    sessions: sessions.rows.map((s) => ({
      id: s.id as string,
      createdAt: new Date(s.created_at as string | Date).toISOString(),
      expiresAt: new Date(s.expires_at as string | Date).toISOString(),
      ip: (s.ip as string | null) ?? null,
      userAgent: (s.user_agent as string | null) ?? null,
    })),
    journal: journal.rows.map((j) => ({
      seq: Number(j.seq),
      occurredAt: new Date(j.occurred_at as string | Date).toISOString(),
      action: j.action as string,
      operatorName: (j.operator_name as string | null) ?? null,
      operatorLogin: (j.operator_login as string | null) ?? null,
      payload: (j.payload as Record<string, unknown> | null) ?? {},
      prevHash: (j.prev_hash as string | null) ?? null,
      entryHash: j.entry_hash as string,
    })),
  };
}
