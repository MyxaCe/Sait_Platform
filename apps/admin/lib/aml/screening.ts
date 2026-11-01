import type { PoolClient } from 'pg';
import { getPool, type Queryable } from '../db';
import { appendJournalEntry } from '../journal/journal';
import { applyClientBlockWithinTx } from '../clients/block';
import {
  coversAllRequiredForClear,
  normalizeSanctionsLists,
  sanctionsListLabel,
  type AmlOutcome,
  type SanctionsListId,
} from './lists';

/**
 * Фиксация результата ручного AML-скрининга клиента (ADM-14, Р-454 I-5, Р-456 D,
 * Р-049).
 *
 * Образец — `lib/kyc/decide.ts` и `lib/clients/block.ts`: один скрининг = одна
 * транзакция, и в ней НЕРАЗДЕЛИМЫЕ факты:
 *  1. upsert `client_aml_screening` (первый скрининг создаёт строку);
 *  2. запись в неизменяемый журнал через `appendJournalEntry` (кто/когда/
 *     основание/клиент/какие списки) и привязка `last_journal_seq` к ней;
 *  3. при исходе «найдено» — АВТОМАТИЧЕСКАЯ блокировка клиента ТОЙ ЖЕ
 *     транзакцией (Р-456 D), с отдельной записью `client.block`.
 * Либо всё, либо ничего (BEGIN/COMMIT): состояние без записи — решение без
 * следа, запись без состояния — след без решения.
 *
 * **Проверку оператор делает ВРУЧНУЮ во внешних источниках** (OFSI/OFAC/EU,
 * PEP); система фиксирует РЕЗУЛЬТАТ с основанием. Два исхода:
 *   clear     → `client.aml_checked`   (проверено, совпадений нет)
 *   escalated → `client.aml_escalated` (найдено → эскалация) + авто-блок
 *
 * **Авто-блок — НЕ на усмотрение оператора (Р-456 D).** «Найдено» означает
 * возможное санкционное совпадение; клиент блокируется автоматически, без
 * отдельного решения. Блокировка — часть ТОЙ ЖЕ транзакции (переиспользуем
 * ядро зоны ADM-02 `applyClientBlockWithinTx`, не дублируя схему
 * `client_blocks`). Снятие — только отдельным действием после ручной проверки
 * (`clearAmlEscalation`).
 *
 * **Нет гарда перехода (в отличие от KYC).** AML-скрининг — повторяемое
 * СОБЫТИЕ (периодическая пересверка — норма), а не одноразовый переход. Фиксация
 * возможна из любого статуса, и КАЖДАЯ журналируется.
 *
 * **Основание обязательно** для обоих исходов (Р-049/Р-394). **Для «clear»
 * обязательны ВСЕ ТРИ списка** (OFSI+OFAC+EU, Р-456 D) — «совпадений нет» не
 * принимается, пока сверка не покрыла каждый. Для «escalated» достаточно одного
 * (совпадение по любому уже требует эскалации).
 *
 * `operatorId` берётся из СЕССИИ вызывающим server action-ом, НЕ из формы
 * (Р-451). Роль-гейт — на стороне action-а; это ядро получает проверенную личность.
 */

export interface RecordScreeningInput {
  /** `operators.id` автора — из серверной сессии, НЕ из формы. */
  operatorId: string;
  /** `users.id` клиента, о котором результат. */
  userId: string;
  outcome: AmlOutcome;
  /** По каким спискам сведён результат (для «clear» — все три). */
  listsChecked: readonly SanctionsListId[];
  /** Основание — обязательно и непустое. */
  reason: string;
}

export type RecordScreeningResult =
  | { ok: true; status: AmlOutcome; journalSeq: number; autoBlocked: boolean }
  /** Нет основания — fail-closed, ничего не пишем. */
  | { ok: false; reason: 'missingReason' }
  /** Ни одного известного списка — сверка «ни по чему», fail-closed. */
  | { ok: false; reason: 'noLists' }
  /** Исход «clear», но покрыты не все три списка (Р-456 D), fail-closed. */
  | { ok: false; reason: 'listsIncompleteForClear' }
  /** Нет такого клиента (`users`). */
  | { ok: false; reason: 'noClient' };

const ACTIONS: Record<AmlOutcome, string> = {
  clear: 'client.aml_checked',
  escalated: 'client.aml_escalated',
};

/** Основание авто-блока при эскалации — несёт покрытые списки и причину оператора. */
function escalationBlockReason(lists: readonly SanctionsListId[], reason: string): string {
  const labels = lists.map(sanctionsListLabel).join(', ');
  return `AML: совпадение при скрининге (списки: ${labels}). ${reason}`;
}

/** seq только что вставленной записи журнала (по её entry_hash). */
async function journalSeqByHash(db: Queryable, entryHash: string): Promise<number> {
  const seqRow = await db.query(`SELECT seq FROM admin_action_journal WHERE entry_hash = $1`, [
    entryHash,
  ]);
  const seq = Number((seqRow.rows[0] as { seq: number | string } | undefined)?.seq);
  if (!Number.isFinite(seq)) {
    throw new Error('не удалось получить seq записи журнала AML');
  }
  return seq;
}

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
  // «Совпадений нет» принимается только при покрытии всех трёх списков (Р-456 D).
  if (input.outcome === 'clear' && !coversAllRequiredForClear(lists)) {
    return { ok: false, reason: 'listsIncompleteForClear' };
  }

  const client = await pool.connect();
  const db = client as unknown as Queryable;
  try {
    await client.query('BEGIN');

    // Клиент обязан существовать: FK поймал бы и так, но понятный отказ лучше.
    const exists = await client.query(`SELECT 1 FROM users WHERE id = $1`, [input.userId]);
    if (exists.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'noClient' };
    }

    const willBlock = input.outcome === 'escalated';

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
        payload: { basis: reason, lists, outcome: input.outcome, manual: true, autoBlock: willBlock },
      },
      db,
    );
    const journalSeq = await journalSeqByHash(db, entry.entryHash);

    await client.query(`UPDATE client_aml_screening SET last_journal_seq = $2 WHERE user_id = $1`, [
      input.userId,
      journalSeq,
    ]);

    // Р-456 D: «найдено» → АВТОМАТИЧЕСКИЙ блок клиента ТОЙ ЖЕ транзакцией.
    // Отдельная журнальная запись `client.block` (переиспользуем ядро ADM-02).
    // Если клиент уже заблокирован — блок идемпотентен (нет содержательного
    // перехода), AML-эскалация всё равно зафиксирована; это не ошибка.
    let autoBlocked = false;
    if (willBlock) {
      const outcome = await applyClientBlockWithinTx(db, {
        operatorId: input.operatorId,
        userId: input.userId,
        action: 'block',
        reason: escalationBlockReason(lists, reason),
      });
      autoBlocked = outcome.applied;
    }

    await client.query('COMMIT');
    return { ok: true, status: input.outcome, journalSeq, autoBlocked };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export interface ClearEscalationInput {
  /** `operators.id` автора — из серверной сессии, НЕ из формы. */
  operatorId: string;
  /** `users.id` клиента. */
  userId: string;
  /** Основание — почему эскалация признана ложной (обязательно). */
  reason: string;
}

export type ClearEscalationResult =
  | { ok: true; unblocked: boolean; journalSeq: number }
  /** Нет основания — fail-closed. */
  | { ok: false; reason: 'missingReason' }
  /** Нет такого клиента (`users`). */
  | { ok: false; reason: 'noClient' }
  /** Клиент не в статусе `escalated` — снимать нечего. */
  | { ok: false; reason: 'notEscalated' };

/**
 * Снятие AML-эскалации после РУЧНОЙ проверки (Р-456 D) — отдельное действие,
 * обратное авто-блоку. В одной транзакции:
 *  1. статус скрининга `escalated → clear` (ложное срабатывание подтверждено);
 *  2. журнал `client.aml_escalation_cleared` (кто/когда/почему);
 *  3. РАЗБЛОКИРОВКА клиента (ядро ADM-02) + запись `client.unblock`.
 *
 * Гард: снимать можно ТОЛЬКО из `escalated` (иначе `notEscalated`) — чтобы
 * действие не разблокировало клиента, заблокированного не по AML. Строку AML
 * держит `FOR UPDATE` (защита от гонки). Если клиент к этому моменту уже
 * разблокирован (например, админом вручную) — разблокировка идемпотентна, AML
 * всё равно переводится в `clear`.
 *
 * Снятие НЕ перезаписывает `lists_checked`: это ревизия вердикта, а не новая
 * трёх-списочная сверка; основание объясняет, что совпадение признано ложным.
 */
export async function clearAmlEscalation(
  input: ClearEscalationInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<ClearEscalationResult> {
  const reason = input.reason?.trim() ?? '';
  if (reason.length === 0) {
    return { ok: false, reason: 'missingReason' };
  }

  const client = await pool.connect();
  const db = client as unknown as Queryable;
  try {
    await client.query('BEGIN');

    const exists = await client.query(`SELECT 1 FROM users WHERE id = $1`, [input.userId]);
    if (exists.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'noClient' };
    }

    // Снимать можно только эскалацию. Строку держим FOR UPDATE до COMMIT.
    const cur = await client.query(
      `SELECT status FROM client_aml_screening WHERE user_id = $1 FOR UPDATE`,
      [input.userId],
    );
    const status = (cur.rows[0] as { status: string } | undefined)?.status;
    if (status !== 'escalated') {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'notEscalated' };
    }

    await client.query(
      `UPDATE client_aml_screening
          SET status = 'clear', reason = $2, screened_by = $3, screened_at = now(), updated_at = now()
        WHERE user_id = $1`,
      [input.userId, reason, input.operatorId],
    );

    const entry = await appendJournalEntry(
      {
        operatorId: input.operatorId,
        action: 'client.aml_escalation_cleared',
        subjectKind: 'client',
        subjectId: input.userId,
        payload: { basis: reason, previousStatus: 'escalated', falsePositive: true },
      },
      db,
    );
    const journalSeq = await journalSeqByHash(db, entry.entryHash);

    await client.query(`UPDATE client_aml_screening SET last_journal_seq = $2 WHERE user_id = $1`, [
      input.userId,
      journalSeq,
    ]);

    // Разблокировка той же транзакцией (ядро ADM-02). Уже разблокирован →
    // идемпотентно, AML всё равно переведён в clear.
    const unblock = await applyClientBlockWithinTx(db, {
      operatorId: input.operatorId,
      userId: input.userId,
      action: 'unblock',
      reason: `AML: снятие эскалации после ручной проверки. ${reason}`,
    });

    await client.query('COMMIT');
    return { ok: true, unblocked: unblock.applied, journalSeq };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
