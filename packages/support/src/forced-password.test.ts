import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { completeForcedPasswordChange } from './auth-mail';
import { createTestDb, seedUser, type TestDb } from './testing/pg';

/** Временный пароль от менеджера → клиент обязан задать свой (функция 3, 10.11). */
let db: TestDb;
let userId: string;

beforeEach(async () => {
  db = await createTestDb();
  userId = await seedUser(db, { email: 'anna@client.test' });
  for (const h of ['current', 'other-1', 'other-2']) {
    await db.query(`INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (gen_random_uuid(), $1, $2, now() + interval '1 day')`, [userId, h]);
  }
});
afterEach(async () => db.close());

describe('смена временного пароля', () => {
  it('без флага обязательной смены — ничего не меняется', async () => {
    expect(await completeForcedPasswordChange(db, { userId, passwordHash: 'new', keepSessionTokenHash: 'current' })).toEqual({ ok: false, reason: 'notRequired' });
    const u = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
    expect(u.rows[0]!.password_hash).toBe('x');
  });

  it('с флагом: новый хеш, флаг и срок сняты, другие сессии погашены, текущая жива, журнал без пароля', async () => {
    await db.query(`UPDATE users SET password_must_change = true, temp_password_expires_at = now() + interval '1 day' WHERE id = $1`, [userId]);
    expect(await completeForcedPasswordChange(db, { userId, passwordHash: 'bcrypt-new', keepSessionTokenHash: 'current' })).toEqual({ ok: true, sessionsRevoked: 2 });
    const u = await db.query(`SELECT password_hash, password_must_change, temp_password_expires_at FROM users WHERE id = $1`, [userId]);
    expect(u.rows[0]).toEqual({ password_hash: 'bcrypt-new', password_must_change: false, temp_password_expires_at: null });
    const s = await db.query(`SELECT token_hash FROM sessions WHERE user_id = $1`, [userId]);
    expect(s.rows).toEqual([{ token_hash: 'current' }]);
    const j = await db.query(`SELECT action, payload FROM admin_action_journal WHERE subject_id = $1`, [userId]);
    expect(j.rows).toEqual([{ action: 'client.credentials.temp_password_replaced', payload: { otherSessionsRevoked: 2 } }]);
  });
});
