import type { PoolClient } from 'pg';
import { getPool } from './db';
import { hashPassword } from './auth/password';
import { appendJournalEntry } from './journal/journal';

/**
 * Одноразовый сид первого суперадмина (ADM-01, Р-451, гибрид).
 *
 * Гибридный завод операторов: первый — ручным одноразовым сидом, остальные —
 * провижинингом (ADM-04). Сид должен быть РОВНО одноразовым, иначе это
 * бэкдор, а не загрузка. Поэтому:
 *
 *  - ГАРДА: отказ, если в `operators` есть ЛЮБАЯ запись (не «нет такого
 *    логина» — именно «таблица не пуста»). Второй админ появляется только
 *    провижинингом.
 *  - Создание оператора и запись о нём — ОДНОЙ транзакцией, под
 *    `LOCK TABLE operators`: два одновременных сида не проскочат гонкой мимо
 *    гарды (оба увидели бы пустую таблицу и оба вставили бы).
 *  - Журнал: `action=operator.bootstrap`, основание `bootstrap` (Р-451:
 *    кто/когда/основание; для сида основание именно «bootstrap»).
 *
 * Пароль и логин — из окружения (вызывающий скрипт их читает), не из кода.
 */

export interface BootstrapInput {
  login: string;
  displayName: string;
  password: string;
}

export type BootstrapResult =
  | { ok: true; operatorId: string }
  /** Таблица операторов не пуста — сид отключён (не бэкдор). */
  | { ok: false; reason: 'alreadyBootstrapped' };

export async function bootstrapFirstOperator(
  input: BootstrapInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<BootstrapResult> {
  // Пароль хешируем ДО транзакции: argon2 долгий, держать на нём блокировку
  // таблицы незачем.
  const passwordHash = await hashPassword(input.password);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Сериализуем сиды между собой: пока держим блокировку, второй сид ждёт,
    // увидит уже непустую таблицу и откажет.
    await client.query('LOCK TABLE operators IN EXCLUSIVE MODE');

    const existing = await client.query('SELECT 1 FROM operators LIMIT 1');
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'alreadyBootstrapped' };
    }

    const inserted = await client.query(
      `INSERT INTO operators (login, display_name, role, password_hash)
       VALUES ($1, $2, 'admin', $3)
       RETURNING id`,
      [input.login, input.displayName, passwordHash],
    );
    const operatorId = inserted.rows[0].id as string;

    // Запись о сиде — ТОЙ ЖЕ транзакцией (журнал неизменяем базой). Основание
    // «bootstrap» — так Р-451 называет происхождение первого оператора.
    await appendJournalEntry(
      {
        operatorId,
        action: 'operator.bootstrap',
        subjectKind: 'operator',
        subjectId: operatorId,
        payload: { login: input.login, role: 'admin', basis: 'bootstrap' },
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
