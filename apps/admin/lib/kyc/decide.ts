import type { PoolClient } from 'pg';
import { getPool } from '../db';
import { appendJournalEntry } from '../journal/journal';

/**
 * Решение оператора по проверке клиента (ADM-08, Р-451 п.4, Р-049).
 *
 * Одно решение = одна транзакция, и в ней ДВА неразделимых факта:
 *  1. смена `client_verification.state`;
 *  2. запись в неизменяемый журнал через `appendJournalEntry` (кто/когда/
 *     основание/клиент) и привязка `last_journal_seq` к ней.
 * Либо оба, либо ни одного: состояние без записи в журнал — это решение без
 * следа, запись без состояния — след без решения. Обе беды закрывает BEGIN/
 * COMMIT.
 *
 * Разрешённые оператору переходы — ТОЛЬКО из `pending`:
 *   pending → verified   (action `client.verification.verified`)
 *   pending → rejected   (action `client.verification.rejected`, с причиной)
 * Из `unverified` решать нечего (клиент ещё не подал), `verified`/`rejected`
 * терминальны для очереди. Гард встроен в UPDATE (`WHERE state = 'pending'`):
 * если к моменту COMMIT клиент уже не pending (другой оператор решил первым,
 * гонка) — строк не обновилось, транзакция откатывается, решение не
 * применяется (fail-closed, оптимистичная блокировка состоянием).
 *
 * operatorId берётся из СЕССИИ вызывающим server action-ом, не из формы:
 * личность автора решения не доверяется данным формы (Р-451).
 */

export type VerificationDecision = 'verified' | 'rejected';

export interface DecideInput {
  /** `operators.id` автора — из серверной сессии, НЕ из формы. */
  operatorId: string;
  /** `users.id` клиента, о котором решение. */
  userId: string;
  decision: VerificationDecision;
  /**
   * Основание. Для `rejected` ОБЯЗАТЕЛЬНО и непустое (клиент должен знать, что
   * исправить); для `verified` — необязательная заметка оператора.
   */
  reason?: string;
}

export type DecideResult =
  | { ok: true; state: VerificationDecision; journalSeq: number }
  /** Причина нужна для отклонения, а её нет/пустая — fail-closed. */
  | { ok: false; reason: 'missingReason' }
  /** Клиент не в `pending` (нет строки, или уже решён, или гонка) — fail-closed. */
  | { ok: false; reason: 'notPending' };

const ACTIONS: Record<VerificationDecision, string> = {
  verified: 'client.verification.verified',
  rejected: 'client.verification.rejected',
};

export async function decideClientVerification(
  input: DecideInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<DecideResult> {
  const reason = input.reason?.trim() ?? '';
  if (input.decision === 'rejected' && reason.length === 0) {
    // Отклонение без причины не пишем: Р-451 требует основание, fail-closed.
    return { ok: false, reason: 'missingReason' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Гард переходом: обновляем ТОЛЬКО если клиент сейчас pending. Иначе 0
    // строк → откат. Это и проверка состояния, и защита от гонки двух
    // операторов (оптимистичная блокировка состоянием).
    const updated = await client.query(
      `UPDATE client_verification
          SET state = $2, updated_at = now()
        WHERE user_id = $1 AND state = 'pending'
      RETURNING user_id`,
      [input.userId, input.decision],
    );
    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'notPending' };
    }

    // Запись решения — ТОЙ ЖЕ транзакцией (журнал неизменяем базой, Р-049).
    const entry = await appendJournalEntry(
      {
        operatorId: input.operatorId,
        action: ACTIONS[input.decision],
        subjectKind: 'client',
        subjectId: input.userId,
        payload: { basis: reason === '' ? null : reason, previousState: 'pending' },
      },
      client as unknown as Parameters<typeof appendJournalEntry>[1],
    );

    // seq только что вставленной записи — по её entry_hash (хеш уникален в
    // цепочке). Привязываем состояние к записи, которая его установила.
    const seqRow = await client.query(
      `SELECT seq FROM admin_action_journal WHERE entry_hash = $1`,
      [entry.entryHash],
    );
    const journalSeq = Number((seqRow.rows[0] as { seq: number | string } | undefined)?.seq);
    if (!Number.isFinite(journalSeq)) {
      // Не нашли свою же запись — что-то не так, не коммитим половину.
      await client.query('ROLLBACK');
      throw new Error('не удалось получить seq записи журнала решения');
    }

    await client.query(
      `UPDATE client_verification SET last_journal_seq = $2 WHERE user_id = $1`,
      [input.userId, journalSeq],
    );

    await client.query('COMMIT');
    return { ok: true, state: input.decision, journalSeq };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
