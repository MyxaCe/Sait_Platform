import { getPool, type Queryable } from '@/lib/db';

/**
 * Чтения для экранов «Риск и плечо», которых нет в `lib/leverage/queries.ts`:
 * кто из клиентов имеет явные настройки плеча (портфель или индивидуальное
 * плечо) — со справочными именами для таблицы. Только чтение, не журналируется
 * (чтения зоны риска не журналируем, §3.8).
 */

export interface ClientLeverageRow {
  userId: string;
  fullName: string;
  email: string;
  portfolioKey: string;
  overrideLeverage: number | null;
  overrideTicket: string | null;
  overrideAt: string | null;
  overrideByName: string | null;
}

export async function listClientLeverageSettings(
  db: Queryable = getPool(),
): Promise<ClientLeverageRow[]> {
  const res = await db.query(
    `SELECT cl.user_id, u.full_name, u.email, cl.portfolio_key,
            cl.override_leverage, cl.override_ticket, cl.override_at,
            o.display_name AS override_by_name
       FROM client_leverage cl
       JOIN users u ON u.id = cl.user_id
       LEFT JOIN operators o ON o.id = cl.override_by
      ORDER BY (cl.override_leverage IS NULL), u.full_name
      LIMIT 200`,
  );
  return res.rows.map((r) => ({
    userId: String(r.user_id),
    fullName: String(r.full_name),
    email: String(r.email),
    portfolioKey: String(r.portfolio_key),
    overrideLeverage: r.override_leverage == null ? null : Number(r.override_leverage),
    overrideTicket: (r.override_ticket as string | null) ?? null,
    overrideAt: r.override_at ? new Date(r.override_at as string | Date).toISOString() : null,
    overrideByName: (r.override_by_name as string | null) ?? null,
  }));
}

/** Имя и email клиента по id (для шапки выбранного клиента), или `null`. */
export async function getClientBrief(
  userId: string,
  db: Queryable = getPool(),
): Promise<{ fullName: string; email: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const res = await db.query(`SELECT full_name, email FROM users WHERE id = $1`, [userId]);
  const r = res.rows[0];
  return r ? { fullName: String(r.full_name), email: String(r.email) } : null;
}

/**
 * Клиенты без строки `client_leverage` — они сидят в портфеле по умолчанию
 * (см. `readTerminalLeverage` в @broker/money). Нужны, чтобы счётчик клиентов
 * портфеля по умолчанию был честным, а не «0».
 */
export async function countClientsInDefaultImplicitly(db: Queryable = getPool()): Promise<number> {
  const res = await db.query(
    `SELECT COUNT(*)::int AS n FROM users u
      WHERE NOT EXISTS (SELECT 1 FROM client_leverage cl WHERE cl.user_id = u.id)`,
  );
  return Number(res.rows[0]?.n ?? 0);
}
