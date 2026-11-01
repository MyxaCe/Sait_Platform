import type { PoolClient } from 'pg';
import { getPool } from '../db';
import { hashPassword } from '../auth/password';
import { appendJournalEntry } from '../journal/journal';
import type { OperatorRole } from '../auth/session';

/**
 * Провижининг операторов (ADM-04, Р-394, Р-049, Р-451).
 *
 * Три действия, и каждое — ОДНА транзакция, несущая два неразделимых факта:
 * изменение строки в `operators` И запись в неизменяемый журнал через
 * `appendJournalEntry` (кто/когда/основание). Либо оба, либо ни одного — по
 * образцу `kyc/decide.ts` и `bootstrap.ts`. Основание (basis) обязательно для
 * всех трёх: провижининг через журнал — требование ADM-04.
 *
 * **Асимметрия Р-394.** Создание — «разрешающее» действие, его можно событием
 * (одна форма, без второго шага). Отключение и смена роли — «отзывающие»,
 * fail-closed: гарды в UPDATE (оптимистичная блокировка состоянием), запрет
 * действовать над самим собой (нельзя отозвать права/отключить себя и
 * запереть вход), а в UI — danger-подтверждение в два шага.
 *
 * **actorId — из сессии вызывающего, НЕ из формы (Р-451):** личность автора не
 * доверяется данным формы, иначе журнал можно подписать чужим именем.
 */

/** Минимальная длина начального пароля оператора. Админ задаёт его при заводе. */
export const OPERATOR_PASSWORD_MIN_LENGTH = 12;

function isRole(value: unknown): value is OperatorRole {
  return value === 'admin' || value === 'operator';
}

// ─── Создать оператора ─────────────────────────────────────────────────────

export interface CreateOperatorInput {
  /** `operators.id` админа-автора — из серверной сессии, НЕ из формы. */
  actorId: string;
  login: string;
  displayName: string;
  role: OperatorRole;
  /** Начальный пароль (argon2id — тот же механизм, что у входа, Р-451). */
  password: string;
  /** Основание (basis) — обязательно, уходит в журнал. */
  reason: string;
}

export type CreateOperatorResult =
  | { ok: true; operatorId: string }
  | { ok: false; reason: 'missingFields' | 'missingReason' | 'weakPassword' | 'invalidRole' | 'loginTaken' };

/**
 * Заводит оператора с ролью и начальным паролем. Пароль хешируется argon2id
 * (переиспользуем `hashPassword` из `lib/auth` — НЕ новый механизм). Второй
 * фактор здесь НЕ трогаем: новый оператор при первом входе будет принудительно
 * проведён на TOTP-enroll существующим флоу (`(protected)/layout.tsx` +
 * `/enroll`), `totp_secret` остаётся NULL = «2FA не настроена».
 */
export async function createOperator(
  input: CreateOperatorInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<CreateOperatorResult> {
  const login = input.login.trim();
  const displayName = input.displayName.trim();
  const reason = input.reason.trim();

  if (login.length === 0 || displayName.length === 0) return { ok: false, reason: 'missingFields' };
  if (!isRole(input.role)) return { ok: false, reason: 'invalidRole' };
  if (reason.length === 0) return { ok: false, reason: 'missingReason' };
  if (input.password.length < OPERATOR_PASSWORD_MIN_LENGTH) return { ok: false, reason: 'weakPassword' };

  // Хешируем ДО транзакции: argon2 долгий, держать на нём транзакцию незачем.
  const passwordHash = await hashPassword(input.password);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let operatorId: string;
    try {
      const inserted = await client.query(
        `INSERT INTO operators (login, display_name, role, password_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [login, displayName, input.role, passwordHash],
      );
      operatorId = inserted.rows[0]!.id as string;
    } catch (error) {
      // Уникальный логин занят (Postgres 23505) — не падаем, сообщаем причину.
      await client.query('ROLLBACK').catch(() => {});
      if ((error as { code?: string }).code === '23505') {
        return { ok: false, reason: 'loginTaken' };
      }
      throw error;
    }

    // Запись о заводе — ТОЙ ЖЕ транзакцией (журнал неизменяем базой, Р-049).
    await appendJournalEntry(
      {
        operatorId: input.actorId,
        action: 'operator.created',
        subjectKind: 'operator',
        subjectId: operatorId,
        payload: { login, role: input.role, basis: reason },
      },
      client as unknown as Parameters<typeof appendJournalEntry>[1],
    );

    await client.query('COMMIT');
    return { ok: true, operatorId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ─── Отключить оператора ────────────────────────────────────────────────────

export interface DisableOperatorInput {
  actorId: string;
  /** `operators.id` отключаемого. */
  operatorId: string;
  reason: string;
}

export type DisableOperatorResult =
  | { ok: true }
  | { ok: false; reason: 'missingReason' | 'selfDisable' | 'notActive' };

/**
 * Отключает оператора (ставит `disabled_at`). Отзывающее действие, fail-closed:
 *  - основание обязательно;
 *  - НЕЛЬЗЯ отключить самого себя (иначе админ запрёт собственный вход — Р-394);
 *  - гард `WHERE disabled_at IS NULL`: уже отключённого не трогаем (0 строк →
 *    откат, `notActive`), это же защита от гонки двух админов.
 * Строку не удаляем — на оператора ссылается журнал; отключение есть состояние.
 */
export async function disableOperator(
  input: DisableOperatorInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<DisableOperatorResult> {
  const reason = input.reason.trim();
  if (reason.length === 0) return { ok: false, reason: 'missingReason' };
  if (input.actorId === input.operatorId) return { ok: false, reason: 'selfDisable' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updated = await client.query(
      `UPDATE operators
          SET disabled_at = now()
        WHERE id = $1 AND disabled_at IS NULL
      RETURNING login`,
      [input.operatorId],
    );
    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'notActive' };
    }

    await appendJournalEntry(
      {
        operatorId: input.actorId,
        action: 'operator.disabled',
        subjectKind: 'operator',
        subjectId: input.operatorId,
        payload: { login: updated.rows[0]!.login as string, basis: reason },
      },
      client as unknown as Parameters<typeof appendJournalEntry>[1],
    );

    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ─── Сменить роль ───────────────────────────────────────────────────────────

export interface ChangeOperatorRoleInput {
  actorId: string;
  operatorId: string;
  newRole: OperatorRole;
  reason: string;
}

export type ChangeOperatorRoleResult =
  | { ok: true; from: OperatorRole; to: OperatorRole }
  | { ok: false; reason: 'missingReason' | 'invalidRole' | 'selfRoleChange' | 'notFound' | 'noChange' };

/**
 * Меняет роль оператора. Отзывающее действие (роль — это права), fail-closed:
 *  - основание обязательно, роль из закрытого множества;
 *  - НЕЛЬЗЯ менять роль самому себе (админ не разжалует себя и не запрёт доступ
 *    к этому экрану — Р-394);
 *  - `SELECT … FOR UPDATE`: читаем текущую роль под блокировкой строки; нет
 *    строки → `notFound`, та же роль → `noChange` (нечего менять и нечего
 *    журналировать). diff from→to уходит в журнал.
 */
export async function changeOperatorRole(
  input: ChangeOperatorRoleInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<ChangeOperatorRoleResult> {
  const reason = input.reason.trim();
  if (!isRole(input.newRole)) return { ok: false, reason: 'invalidRole' };
  if (reason.length === 0) return { ok: false, reason: 'missingReason' };
  if (input.actorId === input.operatorId) return { ok: false, reason: 'selfRoleChange' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query(
      `SELECT role, login FROM operators WHERE id = $1 FOR UPDATE`,
      [input.operatorId],
    );
    const row = current.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'notFound' };
    }
    const from = row.role as OperatorRole;
    if (!isRole(from)) {
      // Текущая роль вне множества — строка сломана, не трактуем (fail-closed).
      await client.query('ROLLBACK');
      throw new Error(`operators.role вне допустимого множества: ${String(from)}`);
    }
    if (from === input.newRole) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'noChange' };
    }

    await client.query(`UPDATE operators SET role = $2 WHERE id = $1`, [
      input.operatorId,
      input.newRole,
    ]);

    await appendJournalEntry(
      {
        operatorId: input.actorId,
        action: 'operator.role_changed',
        subjectKind: 'operator',
        subjectId: input.operatorId,
        payload: { login: row.login as string, from, to: input.newRole, basis: reason },
      },
      client as unknown as Parameters<typeof appendJournalEntry>[1],
    );

    await client.query('COMMIT');
    return { ok: true, from, to: input.newRole };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
