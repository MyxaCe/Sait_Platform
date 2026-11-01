import type { PoolClient } from 'pg';
import { getPool, type Queryable } from '../db';
import { appendJournalEntry } from '../journal/journal';

/**
 * Блокировка / разблокировка клиента (ADM-02, Р-049, Р-394).
 *
 * Образец — `lib/kyc/decide.ts`: одно решение = одна транзакция, и в ней ДВА
 * неразделимых факта:
 *  1. смена `client_blocks.blocked` (первая блокировка создаёт строку);
 *  2. запись в неизменяемый журнал через `appendJournalEntry` (кто/когда/
 *     основание/клиент) и привязка `last_journal_seq` к ней.
 * Либо оба, либо ни одного (BEGIN/COMMIT): состояние без записи — решение без
 * следа, запись без состояния — след без решения.
 *
 * Основание ОБЯЗАТЕЛЬНО и для блока, и для разблока (danger-операция меняет
 * доступ клиента — Р-394 требует основание у любого значимого действия).
 *
 * Разрешён только СОДЕРЖАТЕЛЬНЫЙ переход: заблокировать уже заблокированного
 * или разблокировать не заблокированного — `alreadyInState`, ничего не пишем
 * (идемпотентно и без шумных пустых записей в журнал).
 *
 * `operatorId` берётся из СЕССИИ вызывающим server action-ом, НЕ из формы
 * (Р-451). Роль-гейт (блокировка — только admin) — тоже на стороне action-а
 * (fail-closed): этот модуль — транзакционное ядро, личность и право проверены
 * до входа сюда.
 */

export type BlockAction = 'block' | 'unblock';

export interface BlockInput {
  /** `operators.id` автора решения — из серверной сессии, НЕ из формы. */
  operatorId: string;
  /** `users.id` клиента, о котором решение. */
  userId: string;
  action: BlockAction;
  /** Основание — обязательно и непустое для обоих переходов. */
  reason: string;
}

export type BlockResult =
  | { ok: true; blocked: boolean; journalSeq: number }
  /** Нет основания — fail-closed, ничего не пишем. */
  | { ok: false; reason: 'missingReason' }
  /** Нет такого клиента (`users`). */
  | { ok: false; reason: 'noClient' }
  /** Клиент уже в целевом состоянии — содержательного перехода нет. */
  | { ok: false; reason: 'alreadyInState' };

const ACTIONS: Record<BlockAction, string> = {
  block: 'client.block',
  unblock: 'client.unblock',
};

/**
 * Исход транзакционного ядра блокировки. `applied: false` — содержательного
 * перехода не было (клиент уже в целевом состоянии): ничего не записано, и
 * вызывающий сам решает, ошибка это (ручной блок — `alreadyInState`) или
 * идемпотентный no-op (авто-блок при AML-эскалации на уже заблокированном).
 */
export type BlockTxOutcome =
  | { applied: true; blocked: boolean; journalSeq: number }
  | { applied: false; reason: 'alreadyInState' };

/**
 * Транзакционное ядро блокировки ВНУТРИ уже открытой транзакции (ADM-02).
 *
 * Вынесено из `setClientBlock`, чтобы смежная зона могла сделать блокировку
 * ЧАСТЬЮ СВОЕЙ транзакции, не дублируя схему `client_blocks`: ADM-14
 * (AML-эскалация → авто-блок) журналирует `client.aml_escalated` и
 * `client.block` одним BEGIN/COMMIT. `setClientBlock` теперь тонкая обёртка
 * над этим ядром — её SQL, поведение и контракт не изменились.
 *
 * Предусловия (на вызывающем): `reason` непустой; клиент существует (проверен
 * или поймает FK). Делает ровно то же, что делал встроенный код: `SELECT …
 * FOR UPDATE`, upsert `client_blocks`, append в журнал той же транзакцией,
 * привязка `last_journal_seq`. Содержательного перехода нет → `applied: false`
 * без единой записи.
 */
export async function applyClientBlockWithinTx(
  db: Queryable,
  input: { operatorId: string; userId: string; action: BlockAction; reason: string },
): Promise<BlockTxOutcome> {
  const targetBlocked = input.action === 'block';

  // Текущее состояние: нет строки — не заблокирован. Содержательный переход
  // обязателен (идемпотентность + защита от гонки: строку держит FOR UPDATE).
  const cur = await db.query(`SELECT blocked FROM client_blocks WHERE user_id = $1 FOR UPDATE`, [
    input.userId,
  ]);
  const currentlyBlocked = cur.rows[0] ? Boolean((cur.rows[0] as { blocked: boolean }).blocked) : false;
  if (currentlyBlocked === targetBlocked) {
    return { applied: false, reason: 'alreadyInState' };
  }

  await db.query(
    `INSERT INTO client_blocks (user_id, blocked, reason, blocked_by, updated_at)
          VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id) DO UPDATE
          SET blocked = EXCLUDED.blocked,
              reason = EXCLUDED.reason,
              blocked_by = EXCLUDED.blocked_by,
              updated_at = now()`,
    [input.userId, targetBlocked, input.reason, input.operatorId],
  );

  // Запись решения — ТОЙ ЖЕ транзакцией (журнал неизменяем базой, Р-049).
  const entry = await appendJournalEntry(
    {
      operatorId: input.operatorId,
      action: ACTIONS[input.action],
      subjectKind: 'client',
      subjectId: input.userId,
      payload: { basis: input.reason, previousBlocked: currentlyBlocked },
    },
    db,
  );

  const seqRow = await db.query(`SELECT seq FROM admin_action_journal WHERE entry_hash = $1`, [
    entry.entryHash,
  ]);
  const journalSeq = Number((seqRow.rows[0] as { seq: number | string } | undefined)?.seq);
  if (!Number.isFinite(journalSeq)) {
    throw new Error('не удалось получить seq записи журнала блокировки');
  }

  await db.query(`UPDATE client_blocks SET last_journal_seq = $2 WHERE user_id = $1`, [
    input.userId,
    journalSeq,
  ]);

  return { applied: true, blocked: targetBlocked, journalSeq };
}

export async function setClientBlock(
  input: BlockInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<BlockResult> {
  const reason = input.reason?.trim() ?? '';
  if (reason.length === 0) {
    // Блок/разблок без основания не пишется (Р-394), fail-closed.
    return { ok: false, reason: 'missingReason' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Клиент обязан существовать: FK это и так бы поймал, но вернуть понятный
    // отказ лучше, чем ловить нарушение ограничения.
    const exists = await client.query(`SELECT 1 FROM users WHERE id = $1`, [input.userId]);
    if (exists.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'noClient' };
    }

    const outcome = await applyClientBlockWithinTx(client as unknown as Queryable, {
      operatorId: input.operatorId,
      userId: input.userId,
      action: input.action,
      reason,
    });
    if (!outcome.applied) {
      await client.query('ROLLBACK');
      return { ok: false, reason: outcome.reason };
    }

    await client.query('COMMIT');
    return { ok: true, blocked: outcome.blocked, journalSeq: outcome.journalSeq };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
