import { appendJournalWithinTx, inTransaction, type PoolLike } from '@broker/money';
import { SUPPORT_ACTIONS, SUPPORT_SYSTEM_OPERATOR } from './model';
import type { SupportSettings } from './settings';
import { createWebFormTicketTx } from './tickets';

/**
 * Восстановление потерянных обращений (дефект аудита §1: форма контактов
 * писала `leads(kind='contact')` + событие `lead.submitted`, которое шина
 * отбрасывала — обращения не видел никто). Каждое `contact`-обращение без
 * тикета становится тикетом `web_form` с исходной датой.
 *
 * Идемпотентно: `support_tickets.source_lead_id` UNIQUE — повторный прогон
 * (воркер на старте и раз в 10 минут, ручной скрипт) ничего не дублирует.
 * Подтверждение клиенту задним числом НЕ шлётся: письмо «получили ваш
 * вопрос» через месяц только путает — ответит оператор.
 *
 * Новая форма витрины пишет тикет сама; этот путь закрывает и лиды, которые
 * успеет записать старая версия витрины между миграцией и её выкаткой.
 */
export async function recoverContactLeads(
  db: PoolLike,
  settings: SupportSettings,
  opts: { limit?: number } = {},
): Promise<{ recovered: number; numbers: number[] }> {
  const pending = await db.query(
    `SELECT l.id, l.email, l.locale, l.payload, l.created_at FROM leads l
      WHERE l.kind = 'contact'
        AND NOT EXISTS (SELECT 1 FROM support_tickets t WHERE t.source_lead_id = l.id)
      ORDER BY l.created_at LIMIT $1`,
    [opts.limit ?? 500],
  );
  if (pending.rows.length === 0) return { recovered: 0, numbers: [] };

  return inTransaction<{ recovered: number; numbers: number[] }>(db, async (tx) => {
    const numbers: number[] = [];
    for (const l of pending.rows) {
      const p = (typeof l.payload === 'string' ? JSON.parse(l.payload) : l.payload) as Record<string, unknown>;
      const r = await createWebFormTicketTx(
        tx,
        settings,
        {
          name: String(p.name ?? ''),
          email: String(l.email),
          subject: String(p.topic ?? 'Обращение с сайта'),
          body: String(p.message ?? ''),
          locale: l.locale === 'en' ? 'en' : 'ru',
          leadId: String(l.id),
          createdAt: new Date(l.created_at as string | Date),
        },
        { sendAck: false },
      );
      if (r.ok) numbers.push(r.number);
    }
    if (numbers.length > 0) {
      await appendJournalWithinTx(
        {
          operatorId: SUPPORT_SYSTEM_OPERATOR,
          action: SUPPORT_ACTIONS.leadsRecovered,
          subjectKind: 'platform',
          subjectId: 'support:leads',
          payload: { count: numbers.length, ticketNumbers: numbers },
        },
        tx,
      );
    }
    return { recovered: numbers.length, numbers };
  });
}
