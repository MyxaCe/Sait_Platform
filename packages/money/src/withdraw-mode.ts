import { inTransaction, rollback, type PoolLike, type Queryable } from './db';
import { appendJournalSeqWithinTx } from './journal';

/**
 * Режим вывода — один на всю платформу (docs/site/вывод-ручной-режим.md).
 * manual — оператор одобряет, отправляет USDT сам и вносит хэш (текущее поведение);
 * auto — пока равен manual: исполнителя автоотправки нет (этап 2);
 * stop — аварийный «Стоп»: заявки принимаются, деньги удерживаются, но
 * «Одобрить» и «Отправлено» запрещены всем, включая admin.
 */
export type WithdrawMode = 'auto' | 'manual' | 'stop';

export const WITHDRAW_MODES: readonly WithdrawMode[] = ['auto', 'manual', 'stop'];

export const DEFAULT_WITHDRAW_MODE: WithdrawMode = 'manual';

/** Исполнителя автоотправки ещё нет: «Авто» исполняется как «Ручной». */
export const AUTO_PAYOUT_CONNECTED = false;

export function isWithdrawMode(v: unknown): v is WithdrawMode {
  return v === 'auto' || v === 'manual' || v === 'stop';
}

export interface WithdrawModeState {
  mode: WithdrawMode;
  changedAt: string | null;
  changedBy: string | null;
  changedByLogin: string | null;
}

const isoOrNull = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

function modeOf(v: unknown): WithdrawMode {
  // Неизвестное значение в базе невозможно (CHECK), но если оно всё же
  // встретится — безопаснее считать вывод остановленным, чем открытым.
  if (v === null || v === undefined) return DEFAULT_WITHDRAW_MODE;
  return isWithdrawMode(v) ? v : 'stop';
}

/** Чтение без блокировки — для страниц админки. */
export async function readWithdrawMode(db: Queryable): Promise<WithdrawModeState> {
  const r = await db.query(
    `SELECT s.withdraw_mode, s.withdraw_mode_changed_at, s.withdraw_mode_changed_by, o.login AS changed_by_login
       FROM platform_money_settings s LEFT JOIN operators o ON o.id = s.withdraw_mode_changed_by
      WHERE s.id = 1`,
  );
  const row = r.rows[0];
  if (!row) return { mode: DEFAULT_WITHDRAW_MODE, changedAt: null, changedBy: null, changedByLogin: null };
  return {
    mode: modeOf(row.withdraw_mode),
    changedAt: isoOrNull(row.withdraw_mode_changed_at),
    changedBy: (row.withdraw_mode_changed_by as string | null) ?? null,
    changedByLogin: (row.changed_by_login as string | null) ?? null,
  };
}

/**
 * Режим внутри транзакции смены статуса заявки. FOR SHARE против FOR UPDATE
 * переключателя: одобрение, начатое до коммита «Стопа», ждёт его и читает уже
 * «stop» (READ COMMITTED перечитывает строку после ожидания блокировки);
 * переключение, начатое во время одобрения, ждёт его коммита — такое одобрение
 * случилось до «Стопа». Проскочить между ними нельзя.
 */
export async function lockWithdrawModeWithinTx(tx: Queryable): Promise<WithdrawMode> {
  const r = await tx.query(`SELECT withdraw_mode FROM platform_money_settings WHERE id = 1 FOR SHARE`);
  return modeOf(r.rows[0]?.withdraw_mode);
}

export type WithdrawModeResult =
  | { ok: true; journalSeq: number; before: WithdrawMode; after: WithdrawMode }
  | { ok: false; reason: 'missingReason' | 'invalidMode' | 'noChange' };

export async function setWithdrawMode(
  pool: PoolLike,
  input: { operatorId: string; reason: string; mode: unknown },
): Promise<WithdrawModeResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'missingReason' };
  if (!isWithdrawMode(input.mode)) return { ok: false, reason: 'invalidMode' };
  const next = input.mode;

  return inTransaction<WithdrawModeResult>(pool, async (tx) => {
    await tx.query(`INSERT INTO platform_money_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    const cur = await tx.query(`SELECT withdraw_mode FROM platform_money_settings WHERE id = 1 FOR UPDATE`);
    const before = modeOf(cur.rows[0]?.withdraw_mode);
    if (before === next) return rollback<WithdrawModeResult>({ ok: false, reason: 'noChange' });

    const q = await tx.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'requested') AS requested,
              COUNT(*) FILTER (WHERE status = 'approved') AS approved
         FROM crypto_withdrawals`,
    );
    const queue = { requested: Number(q.rows[0]?.requested ?? 0), approved: Number(q.rows[0]?.approved ?? 0) };

    await tx.query(
      `UPDATE platform_money_settings
          SET withdraw_mode = $1, withdraw_mode_changed_at = now(), withdraw_mode_changed_by = $2,
              updated_at = now(), updated_by = $2
        WHERE id = 1`,
      [next, input.operatorId],
    );
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: input.operatorId,
        action: 'platform.withdraw_mode.changed',
        subjectKind: 'platform',
        subjectId: 'withdraw_mode',
        payload: { basis: reason, before, after: next, queue },
      },
      tx,
    );
    await tx.query(`UPDATE platform_money_settings SET last_journal_seq = $1 WHERE id = 1`, [seq]);
    return { ok: true, journalSeq: seq, before, after: next };
  });
}

export type ManualOnlyResult =
  | { ok: true; journalSeq: number }
  | { ok: false; reason: 'missingReason' | 'noClient' | 'noChange' };

/** Флаг клиента «только ручной вывод». Ставят admin и finance_operator. */
export async function setClientWithdrawManualOnly(
  pool: PoolLike,
  input: { operatorId: string; userId: string; reason: string; value: boolean },
): Promise<ManualOnlyResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'missingReason' };

  return inTransaction<ManualOnlyResult>(pool, async (tx) => {
    const user = await tx.query(`SELECT 1 FROM users WHERE id = $1`, [input.userId]);
    if (user.rows.length === 0) return rollback<ManualOnlyResult>({ ok: false, reason: 'noClient' });
    await tx.query(
      `INSERT INTO client_money_flags (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [input.userId],
    );
    const cur = await tx.query(
      `SELECT withdraw_manual_only FROM client_money_flags WHERE user_id = $1 FOR UPDATE`,
      [input.userId],
    );
    const before = Boolean(cur.rows[0]?.withdraw_manual_only);
    if (before === input.value) return rollback<ManualOnlyResult>({ ok: false, reason: 'noChange' });

    await tx.query(
      `UPDATE client_money_flags SET withdraw_manual_only = $2, updated_at = now(), updated_by = $3 WHERE user_id = $1`,
      [input.userId, input.value, input.operatorId],
    );
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: input.operatorId,
        action: input.value ? 'client.money.withdraw_manual_only_on' : 'client.money.withdraw_manual_only_off',
        subjectKind: 'client',
        subjectId: input.userId,
        payload: { basis: reason, field: 'withdrawManualOnly', before, after: input.value },
      },
      tx,
    );
    await tx.query(`UPDATE client_money_flags SET last_journal_seq = $2 WHERE user_id = $1`, [input.userId, seq]);
    return { ok: true, journalSeq: seq };
  });
}

/** Флаг «только ручной вывод» клиента (чтение для карточки). */
export async function readClientWithdrawManualOnly(db: Queryable, userId: string): Promise<boolean> {
  const r = await db.query(`SELECT withdraw_manual_only FROM client_money_flags WHERE user_id = $1`, [userId]);
  return Boolean(r.rows[0]?.withdraw_manual_only);
}
