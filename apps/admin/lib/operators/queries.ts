import { getPool, type Queryable } from '../db';
import type { OperatorRole } from '../auth/session';

/**
 * Чтения операторской поверхности «Операторы» (ADM-04, Р-395).
 *
 * Список операторов — для провижининга: кто заведён, с какой ролью, когда и не
 * отключён ли. Секрет TOTP и хеш пароля сюда НЕ попадают: экран управляет
 * доступом, а не раскрывает учётные материалы (Р-451). totp_enrolled_at берём
 * как факт «2FA включена» (без самого секрета) — это помогает оператору-админу
 * видеть, прошёл ли коллега обязательную регистрацию второго фактора.
 */

export interface OperatorListItem {
  id: string;
  login: string;
  displayName: string;
  role: OperatorRole;
  createdAt: string;
  /** `null` — активен; иначе момент отключения (Р-394 fail-closed). */
  disabledAt: string | null;
  /** `true`, если TOTP подтверждён (totp_enrolled_at IS NOT NULL). */
  totpEnrolled: boolean;
}

/** Приводим строку БД к известной роли или бросаем (fail-closed, строка сломана). */
export function asRole(value: unknown): OperatorRole {
  if (value === 'admin' || value === 'operator' || value === 'finance_operator') return value;
  throw new Error(`operators.role вне допустимого множества: ${String(value)}`);
}

/**
 * Все операторы, новые сверху. Включая отключённых: отключение — это состояние,
 * а не удаление (строку оператора не стираем — на неё ссылается журнал), и
 * админу надо видеть отключённых, чтобы при нужде вернуть или не плодить дубль.
 */
export async function listOperators(db: Queryable = getPool()): Promise<OperatorListItem[]> {
  const result = await db.query(
    `SELECT id, login, display_name, role, created_at, disabled_at, totp_enrolled_at
       FROM operators
      ORDER BY created_at DESC`,
  );
  return result.rows.map((r) => ({
    id: r.id as string,
    login: r.login as string,
    displayName: r.display_name as string,
    role: asRole(r.role),
    createdAt: new Date(r.created_at as string | Date).toISOString(),
    disabledAt: r.disabled_at ? new Date(r.disabled_at as string | Date).toISOString() : null,
    totpEnrolled: r.totp_enrolled_at !== null && r.totp_enrolled_at !== undefined,
  }));
}
