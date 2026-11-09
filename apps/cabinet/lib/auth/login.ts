import { getPool } from '../db';
import { verifyPassword } from './password';

/**
 * Проверка входа клиента — ядро `loginAction`, вынесено ради тестов
 * (блокировка обязана действовать на входе, и это проверяемое свойство, а
 * не «наверное работает в экшене»).
 *
 * **Блокировка (ADM-02).** Оператор блокирует клиента в центре управления
 * (`client_blocks.blocked = true`, ручной блок или AML авто-блок). До этого
 * кабинет таблицу не читал вовсе — блок был записью в журнале, а клиент
 * продолжал входить. Теперь заблокированный получает `accessRestricted`
 * («доступ ограничен, обратитесь в поддержку»).
 *
 * **Порядок проверок намеренный:** о блокировке говорим ТОЛЬКО после верного
 * пароля. Иначе форма входа стала бы оракулом «этот email существует и
 * заблокирован» для любого, кто его наберёт.
 *
 * Хеш сверяем и для несуществующего email — одинаковое время ответа.
 */
export type LoginCheck =
  | { ok: true; userId: string; locale: string }
  | { ok: false; error: 'invalidCredentials' | 'accessRestricted' };

/** Хеш-заглушка для несуществующего email: сверка идёт, совпадения не будет. */
const DUMMY_HASH = '$2a$12$invalidsaltinvalidsaltinvalidsaltinval';

export async function checkLogin(email: string, password: string): Promise<LoginCheck> {
  const r = await getPool().query(
    `SELECT u.id, u.password_hash, u.locale, COALESCE(cb.blocked, false) AS blocked
       FROM users u
       LEFT JOIN client_blocks cb ON cb.user_id = u.id
      WHERE lower(u.email) = lower($1)`,
    [email],
  );
  const row = r.rows[0];
  const ok = row
    ? await verifyPassword(password, row.password_hash)
    : await verifyPassword(password, DUMMY_HASH);
  if (!row || !ok) return { ok: false, error: 'invalidCredentials' };
  if (row.blocked) return { ok: false, error: 'accessRestricted' };
  return { ok: true, userId: row.id as string, locale: String(row.locale ?? 'ru') };
}
