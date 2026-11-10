import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createTestDb, type TestDb } from '@broker/support/testing';
import { PgLeadStore } from './store';

/**
 * Форма контактов → тикет поддержки (дефект аудита: обращения уходили
 * событием `lead.submitted` в шину без подписчиков, и их не видел никто).
 * Лид, событие и тикет пишутся ОДНОЙ транзакцией; форма, выключенная в
 * настройках поддержки, не принимает обращение вовсе (ничего не пишется).
 */
let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => db.close());

const draft = {
  kind: 'contact' as const,
  name: 'Пётр Гость',
  email: 'guest@client.example',
  topic: 'payments' as const,
  message: 'Подал заявку на вывод, где деньги?',
  locale: 'ru' as const,
};

describe('форма контактов → тикет', () => {
  it('лид + событие + тикет web_form одной транзакцией; номер возвращается форме', async () => {
    const store = new PgLeadStore(db as unknown as Pool);
    const r = await store.createLead(draft);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) throw new Error();
    expect(r.ticketNumber).toBeGreaterThanOrEqual(1001);
    const t = await db.query(`SELECT origin_channel, reply_channel, subject, category, source_lead_id FROM support_tickets`);
    expect(t.rows[0]).toEqual({
      origin_channel: 'web_form',
      reply_channel: 'email',
      subject: 'Пополнение и вывод',
      category: 'deposit',
      source_lead_id: r.leadId,
    });
    expect((await db.query(`SELECT count(*)::int AS n FROM outbox`)).rows[0]!.n).toBe(1);
    // Подтверждение гостю — в очереди писем.
    expect((await db.query(`SELECT purpose FROM outbound_mail`)).rows).toEqual([{ purpose: 'support_ack' }]);
  });

  it('форма выключена в настройках поддержки → отказ, ничего не записано', async () => {
    await db.query(`UPDATE support_settings SET settings = '{"channels":{"webForm":false}}' WHERE id = 1`);
    const r = await new PgLeadStore(db as unknown as Pool).createLead(draft);
    expect(r).toEqual({ ok: false, reason: 'channelDisabled' });
    expect((await db.query(`SELECT count(*)::int AS n FROM leads`)).rows[0]!.n).toBe(0);
  });

  it('заявка на счёт (account-opening) тикета не создаёт', async () => {
    const r = await new PgLeadStore(db as unknown as Pool).createLead({
      kind: 'account-opening',
      firstName: 'Анна',
      lastName: 'Клиентова',
      email: 'a@client.example',
      phone: '+70000000000',
      country: 'RU',
      accountType: 'standard',
      locale: 'ru',
    } as never);
    expect(r.ok).toBe(true);
    expect((await db.query(`SELECT count(*)::int AS n FROM support_tickets`)).rows[0]!.n).toBe(0);
  });
});
