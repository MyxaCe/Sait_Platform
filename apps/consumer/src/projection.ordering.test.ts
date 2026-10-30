import type { ParsedTerminalEvent } from '@broker/api-client';
import { describe, expect, it } from 'vitest';
import {
  applyTerminalEvent,
  BalanceAccountMissingError,
  classifyMessage,
  type Querier,
} from './projection.js';

/*
 * WEB-43 · порядок перезаписи остатка по accountSeq (КОНТРАКТЫ §5, Р-441).
 *
 * Свидетель остатков поймал расхождение в тринадцать копеек: два события о
 * балансе применились за ~4 мс в порядке, обратном журналу. Причина (Р-438):
 * prefetch(16) и необёрнутый обработчик — до шестнадцати проекций идут
 * ОДНОВРЕМЕННО, и остаток пишет та, чей UPDATE закончил последним. Слепой
 * `UPDATE ... WHERE user_id` — last-writer-wins: старое событие с остатком
 * 10 000.00 затирало свежее 9 999.87.
 *
 * Эти тесты РИНГУЮТ, пока причина жива. Красные против слепого UPDATE,
 * зелёные — когда перезапись идёт только при строго большем accountSeq.
 * Убрать guard — и они снова краснеют: это их работа.
 */

/**
 * Фейк demo_accounts С СОСТОЯНИЕМ. Обычный фейк из projection.test.ts всегда
 * отдаёт rowCount:1 и ничего не помнит — им нельзя проверить ни отбрасывание
 * устаревшего, ни различение «нет строки» и «строка старше». guard живёт в
 * SQL, поэтому фейк ЧЕСТНО исполняет условие WHERE из текста запроса:
 *
 *  - запрос со слепым `WHERE user_id` (нынешний код) применяет всегда;
 *  - запрос с `account_seq <` (фикс) применяет только при строго большем.
 *
 * Так один и тот же тест красен против слепого кода и зелен против фикса.
 * Фейк НЕ доказывает атомарность pg (это забота pg и одиночного UPDATE) —
 * он доказывает, что проекция кладёт номер в условие и верно трактует ноль
 * обновлённых строк.
 */
function fakeDb() {
  const accounts = new Map<string, { balance: number; seq: number | null }>();
  const processed = new Set<string>();
  const notifications: unknown[][] = [];

  const db: Querier = {
    async query(sql, params = []) {
      if (sql.includes('INSERT INTO processed_events')) {
        const id = String(params[0]);
        if (processed.has(id)) return { rows: [], rowCount: 0 };
        processed.add(id);
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes('INSERT INTO demo_accounts')) {
        const userId = String(params[0]);
        const balance = Number(params[1]);
        const seq = params[3] === undefined || params[3] === null ? null : Number(params[3]);
        const prev = accounts.get(userId);
        accounts.set(userId, { balance, seq: seq ?? prev?.seq ?? null });
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes('UPDATE demo_accounts')) {
        // Нынешний код: [balance, userId]. Фикс: [balance, seq, userId].
        const guarded = sql.includes('account_seq');
        const balance = Number(params[0]);
        const seq = guarded
          ? params[1] === undefined || params[1] === null
            ? null
            : Number(params[1])
          : null;
        const userId = String(guarded ? params[2] : params[1]);

        const row = accounts.get(userId);
        if (!row) return { rows: [], rowCount: 0 }; // строки нет — счёт отсутствует

        // Строго больший: NULL с любой стороны пропускает guard (упорядочить
        // нечем), иначе применяем только при row.seq < seq.
        const pass = !guarded || seq === null || row.seq === null || row.seq < seq;
        if (!pass) return { rows: [], rowCount: 0 }; // устаревшее — ноль строк

        row.balance = balance;
        if (guarded) row.seq = seq ?? row.seq; // COALESCE: NULL не затирает номер
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes('SELECT 1 FROM demo_accounts')) {
        const has = accounts.has(String(params[0]));
        return { rows: has ? [{ ok: 1 }] : [], rowCount: has ? 1 : 0 };
      }

      if (sql.includes('INSERT INTO notifications')) {
        notifications.push(params);
        return { rows: [], rowCount: 1 };
      }

      // demo_positions и прочее — не предмет WEB-43
      return { rows: [], rowCount: 1 };
    },
  };

  return { db, accounts, notifications };
}

const cfg = { tenant: 'apex-ru', newId: () => '00000000-0000-0000-0000-000000000000' };

function envelope(event: string, data: unknown, eventId = crypto.randomUUID()) {
  return {
    event_id: eventId,
    event,
    version: 1,
    occurred_at: '2026-07-27T10:00:00.000Z',
    source: 'terminal',
    data,
  };
}

/** Разобрать событие баланса, сохранив его event_id. */
function balance(data: Record<string, unknown>, eventId = crypto.randomUUID()) {
  const r = classifyMessage(envelope('terminal.balance.changed', { tenant: 'apex-ru', ...data }, eventId));
  if (r.kind !== 'terminal-event') throw new Error(`ожидалось событие, а не ${r.kind}`);
  return { eventId: r.eventId, event: r.event as ParsedTerminalEvent };
}

/** Применить одно событие через проекцию. */
function apply(db: Querier, b: { eventId: string; event: ParsedTerminalEvent }) {
  return applyTerminalEvent(db, b.eventId, b.event, cfg);
}

/**
 * Завести счёт. `balance.changed` только ОБНОВЛЯЕТ строку, не создаёт её —
 * поэтому каждый тест о порядке сперва открывает счёт, как в жизни. Открытие
 * само по себе accountSeq не ставит (оно вне охвата WEB-43): строка стартует с
 * номером NULL, и первое же событие баланса с номером его задаёт.
 */
async function open(db: Querier, userId: string, balanceCents = 1_000_000) {
  const r = classifyMessage(
    envelope('terminal.account.opened', { tenant: 'apex-ru', userId, currency: 'USD', balanceCents }),
  );
  if (r.kind !== 'terminal-event') throw new Error(`ожидалось событие, а не ${r.kind}`);
  await applyTerminalEvent(db, r.eventId, r.event as ParsedTerminalEvent, cfg);
}

describe('WEB-43 · перезапись остатка только при строго большем accountSeq', () => {
  it('свежее по accountSeq побеждает, даже когда применено ПОСЛЕ устаревшего', async () => {
    const { db, accounts } = fakeDb();
    await open(db, 'u1');
    // Затравка номера нормальным путём: первое же событие ставит row.seq.
    await apply(db, balance({ userId: 'u1', balanceCents: 998700, accountSeq: 6 })); // свежее, 9 999.87
    const outcome = await apply(db, balance({ userId: 'u1', balanceCents: 1005000, accountSeq: 5 })); // старое, приходит последним

    // Гонку воспроизводит «старое применяется последним»: если оно всё равно
    // не перезаписало — порядок записи больше не решает исход (13 копеек).
    expect(accounts.get('u1')?.balance).toBe(998700);
    expect(outcome).toBe('skipped-stale');
  });

  it('равный accountSeq НЕ перезаписывает (строго больший, не ≤ — иначе съели бы соседей по пачке)', async () => {
    const { db, accounts } = fakeDb();
    await open(db, 'u1');
    await apply(db, balance({ userId: 'u1', balanceCents: 100, accountSeq: 5 }));
    const outcome = await apply(db, balance({ userId: 'u1', balanceCents: 200, accountSeq: 5 }));

    expect(accounts.get('u1')?.balance).toBe(100);
    expect(outcome).toBe('skipped-stale');
  });

  it('устаревание ≠ отсутствие счёта: старое событие ОТБРАСЫВАЕТСЯ, а не бросает (WEB-29 не воскрешаем)', async () => {
    const { db } = fakeDb();
    await open(db, 'u1');
    await apply(db, balance({ userId: 'u1', balanceCents: 998700, accountSeq: 6 }));
    // Ноль обновлённых строк здесь — «старше», а не «нет строки». Это не ошибка.
    await expect(apply(db, balance({ userId: 'u1', balanceCents: 1, accountSeq: 5 }))).resolves.toBe(
      'skipped-stale',
    );
  });

  it('отсутствие счёта по-прежнему бросает (деньги есть, строки нет — WEB-29)', async () => {
    const { db } = fakeDb();
    await expect(
      apply(db, balance({ userId: 'missing', balanceCents: 500, accountSeq: 9 })),
    ).rejects.toBeInstanceOf(BalanceAccountMissingError);
  });

  it('переходный период: событие БЕЗ accountSeq применяется и не затирает сохранённый номер (Р-277)', async () => {
    const { db, accounts } = fakeDb();
    await open(db, 'u1');
    await apply(db, balance({ userId: 'u1', balanceCents: 500, accountSeq: 7 }));
    const outcome = await apply(db, balance({ userId: 'u1', balanceCents: 600 })); // без номера

    expect(outcome).toBe('applied');
    expect(accounts.get('u1')?.balance).toBe(600);
    expect(accounts.get('u1')?.seq).toBe(7); // номер уцелел (COALESCE)
  });
});
