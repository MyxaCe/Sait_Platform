import { getPool } from '../db';
import { hashPassword, needsRehash, verifyPassword } from './password';
import type { OperatorSession } from './session';

/**
 * Проверка учётных данных оператора по таблице `operators` (ADM-01, Р-451).
 *
 * Правила входа, каждое — отдельный повод отказать, и ни один не раскрывается
 * наружу (Р-451: общая ошибка, не перечисляем, существует ли логин):
 *
 *  - логин есть в `operators`;
 *  - у него НЕПУСТОЙ `password_hash` (NULL = входа нет, fail-closed Р-394);
 *  - argon2id-сверка пароля прошла;
 *  - `disabled_at IS NULL` — отключённый оператор не входит.
 *
 * Наружу — только `{ ok: false }` без причины. Внутри причины различимы в
 * логе (дежурному), но ответ один: по ответу нельзя узнать, нет ли логина,
 * пуст ли хеш или оператор отключён. Иначе форма превратилась бы в оракул
 * «такой оператор существует».
 *
 * **Единое время ответа.** Для несуществующего логина и для пустого хеша всё
 * равно выполняется argon2-сверка с фиктивным хешем — чтобы время ответа не
 * выдавало, что логина нет (timing-оракул).
 */

export type CredentialsResult =
  | { ok: true; session: OperatorSession }
  | { ok: false };

/**
 * Фиктивный argon2id-хеш на минимальных параметрах для выравнивания времени
 * при отсутствии логина/хеша. Пароль к нему неизвестен — сверка всегда
 * `false`, но стоит примерно столько же, сколько настоящая.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZS1kdW1teS1zYWx0LXZhbA$3QmQk6Qp0m5m0m5m0m5m0m5m0m5m0m5m0m5m0m5m0m4';

interface OperatorRow {
  id: string;
  login: string;
  display_name: string;
  role: string;
  password_hash: string | null;
  disabled_at: Date | null;
}

function asRole(value: string): OperatorSession['role'] | null {
  return value === 'admin' || value === 'operator' ? value : null;
}

export async function verifyOperatorCredentials(
  login: string,
  password: string,
): Promise<CredentialsResult> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, login, display_name, role, password_hash, disabled_at
       FROM operators WHERE login = $1`,
    [login],
  );
  const row = result.rows[0] as OperatorRow | undefined;

  // Нет логина или пустой хеш (NULL = входа нет) — всё равно сверяем с
  // фиктивным хешем, чтобы время ответа молчало о причине (Р-451).
  const hash = row?.password_hash ?? null;
  const passwordOk = await verifyPassword(password, hash ?? DUMMY_HASH);

  if (!row || !hash) {
    console.error(`[admin-login] отказ: ${row ? 'пустой password_hash' : 'нет логина'} (login=${login})`);
    return { ok: false };
  }
  if (!passwordOk) {
    console.error(`[admin-login] отказ: неверный пароль (login=${login})`);
    return { ok: false };
  }
  if (row.disabled_at !== null) {
    // Отключённый не входит, даже с верным паролем (Р-451).
    console.error(`[admin-login] отказ: оператор отключён (login=${login})`);
    return { ok: false };
  }

  const role = asRole(row.role);
  if (!role) {
    // Роль вне допустимых — не «наверное оператор»; строка сломана, вход закрыт.
    console.error(`[admin-login] отказ: неизвестная роль '${row.role}' (login=${login})`);
    return { ok: false };
  }

  // Прозрачный перехеш: параметры хеша отстали от текущего конфига — заменяем
  // на свежий argon2id при успешном входе (Р-451). Best-effort: неудача
  // обновления не роняет вход (пароль-то верный), но называется в логе.
  if (needsRehash(hash)) {
    try {
      const fresh = await hashPassword(password);
      await pool.query(`UPDATE operators SET password_hash = $1 WHERE id = $2`, [fresh, row.id]);
    } catch (error) {
      console.error(`[admin-login] перехеш не удался (login=${login})`, error);
    }
  }

  return {
    ok: true,
    session: {
      operatorId: row.id,
      login: row.login,
      displayName: row.display_name,
      role,
    },
  };
}
