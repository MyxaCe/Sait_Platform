import type { PoolClient } from 'pg';
import { getPool } from '../db';
import { appendJournalEntry } from '../journal/journal';
import { normalizeSanctionsLists, type AmlOutcome, type SanctionsListId } from './lists';

/**
 * Фиксация результата ручного AML-скрининга клиента (ADM-14, Р-454 I-5, Р-049).
 *
 * Образец — `lib/kyc/decide.ts` и `lib/clients/block.ts`: один скрининг = одна
 * транзакция, и в ней ДВА неразделимых факта:
 *  1. upsert `client_aml_screening` (первый скрининг создаёт строку);
 *  2. запись в неизменяемый журнал через `appendJournalEntry` (кто/когда/
 *     основание/клиент/какие списки) и привязка `last_journal_seq` к ней.
 * Либо оба, либо ни одного (BEGIN/COMMIT): состояние без записи — решение без
 * следа, запись без состояния — след без решения.
 *
 * **Проверку оператор делает ВРУЧНУЮ во внешних источниках** (OFSI/OFAC/EU,
 * PEP); система фиксирует РЕЗУЛЬТАТ с основанием. Два исхода:
 *   clear     → `client.aml_checked`   (проверено, совпадений нет)
 *   escalated → `client.aml_escalated` (найдено → эскалация)
 *
 * **Нет гарда перехода (в отличие от KYC).** AML-скрининг — повторяемое
 * СОБЫТИЕ (периодическая пересверка — норма), а не одноразовый переход из
 * `pending`. Поэтому фиксировать результат можно из любого текущего статуса, и
 * КАЖДАЯ фиксация журналируется (аудит видит всю историю сверок). Обновляется
 * строка состояния (последний результат), но история — в журнале, не теряется.
 *
 * **Основание обязательно** для обоих исходов (Р-049/Р-394: значимое действие
 * несёт основание). **Хотя бы один список обязателен** — сверка «ни по чему»
 * не является сверкой (fail-closed). КАКИЕ списки обязательны — политика AML,
 * решение владельца; ядро лишь требует непустой набор из реестра.
 *
 * `operatorId` берётся из СЕССИИ вызывающим server action-ом, НЕ из формы
 * (Р-451). Роль-гейт (operator+admin) — на стороне action-а; это ядро получает
 * уже проверенную личность.
 */

export interface RecordScreeningInput {
  /** `operators.id` автора — из серверной сессии, НЕ из формы. */
  operatorId: string;
  /** `users.id` клиента, о котором результат. */
  userId: string;
  outcome: AmlOutcome;
  /** По каким спискам сведён результат (подмножество реестра; хотя бы один). */
  listsChecked: readonly SanctionsListId[];
  /** Основание — обязательно и непустое. */
  reason: string;
}

export type RecordScreeningResult =
  | { ok: true; status: AmlOutcome; journalSeq: number }
  /** Нет основания — fail-closed, ничего не пишем. */
  | { ok: false; reason: 'missingReason' }
  /** Ни одного известного списка — сверка «ни по чему», fail-closed. */
  | { ok: false; reason: 'noLists' }
  /** Нет такого клиента (`users`). */
  | { ok: false; reason: 'noClient' };

const ACTIONS: Record<AmlOutcome, string> = {
  clear: 'client.aml_checked',
  escalated: 'client.aml_escalated',
};

export async function recordAmlScreening(
  input: RecordScreeningInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<RecordScreeningResult> {
  const reason = input.reason?.trim() ?? '';
  if (reason.length === 0) {
    // Скрининг без основания не пишется (Р-049/Р-394), fail-closed.
    return { ok: false, reason: 'missingReason' };
  }

  // Оставляем только известные списки (без дублей, в порядке реестра). Пустой
  // набор — сверка «ни по чему»: не фиксируем.
  const lists = normalizeSanctionsLists(input.listsChecked);
  if (lists.length === 0) {
    return { ok: false, reason: 'noLists' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Клиент обязан существовать: FK поймал бы и так, но понятный отказ лучше.
    const exists = await client.query(`SELECT 1 FROM users WHERE id = $1`, [input.userId]);
    if (exists.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'noClient' };
    }

    await client.query(
      `INSERT INTO client_aml_screening
         (user_id, status, lists_checked, reason, screened_by, screened_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, now(), now())
       ON CONFLICT (user_id) DO UPDATE
            SET status = EXCLUDED.status,
                lists_checked = EXCLUDED.lists_checked,
                reason = EXCLUDED.reason,
                screened_by = EXCLUDED.screened_by,
                screened_at = EXCLUDED.screened_at,
                updated_at = now()`,
      [input.userId, input.outcome, lists, reason, input.operatorId],
    );

    // Запись результата — ТОЙ ЖЕ транзакцией (журнал неизменяем базой, Р-049).
    const entry = await appendJournalEntry(
      {
        operatorId: input.operatorId,
        action: ACTIONS[input.outcome],
        subjectKind: 'client',
        subjectId: input.userId,
        // Основание и проверенные списки — в payload (что именно сверено).
        payload: { basis: reason, lists, outcome: input.outcome, manual: true },
      },
      client as unknown as Parameters<typeof appendJournalEntry>[1],
    );

    const seqRow = await client.query(`SELECT seq FROM admin_action_journal WHERE entry_hash = $1`, [
      entry.entryHash,
    ]);
    const journalSeq = Number((seqRow.rows[0] as { seq: number | string } | undefined)?.seq);
    if (!Number.isFinite(journalSeq)) {
      // Не нашли свою же запись — не коммитим половину.
      await client.query('ROLLBACK');
      throw new Error('не удалось получить seq записи журнала AML-скрининга');
    }

    await client.query(`UPDATE client_aml_screening SET last_journal_seq = $2 WHERE user_id = $1`, [
      input.userId,
      journalSeq,
    ]);

    await client.query('COMMIT');
    return { ok: true, status: input.outcome, journalSeq };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
