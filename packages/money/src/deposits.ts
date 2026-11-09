import { usdtRawToCents } from './amounts';
import { inTransaction, rollback, type PoolLike, type Queryable } from './db';
import { appendJournalSeqWithinTx } from './journal';
import { loadMoneyPolicyInputs, computeMoneyPolicy, type MoneyPolicyReason } from './policy';
import { SYSTEM_OPERATORS } from './system-operators';
import { externalRef } from './terminal-contract';
import type { TerminalMoneyClient, MoneyMoveOutcome } from './terminal-money';
import { normalizeTxHash } from './tron';

/**
 * Депозиты USDT TRC20 (дизайн §1). Все переходы статуса — с гардом
 * состояния в WHERE, журнал — той же транзакцией.
 *
 *   claimed ──► credited          (наблюдатель: сеть подтвердила)
 *      └──────► rejected          (не тот получатель/токен/неуспешна/нет в сети)
 *   unidentified ──► credited     (оператор привязал к клиенту)
 *   unidentified ──► claimed      (клиент заявил хэш позже, чем его увидела сеть)
 *
 * **Деньги двигает только терминал** (`deposit`, external_ref `tron:<hash>`).
 * Порядок «заблокировать строку (FOR UPDATE) → вызвать терминал → сменить
 * статус → журнал → COMMIT»: пока строка заперта, никто другой (клиент,
 * оператор, второй тик) не может её перехватить. Если COMMIT не прошёл после
 * успешного вызова — строка осталась в прежнем статусе, следующий проход
 * вызовет терминал с ТЕМ ЖЕ ref, и терминал ответит повтором (идемпотентно).
 */

export type DepositStatus = 'claimed' | 'credited' | 'rejected' | 'unidentified';

export type DepositRejectReason =
  | 'wrong_recipient'
  | 'wrong_token'
  | 'failed'
  | 'not_found'
  | 'below_minimum';

export type ClaimResult =
  | { ok: true; depositId: string; fromUnidentified: boolean }
  | { ok: false; reason: 'invalidHash' | 'alreadyClaimed' | 'usedByWithdrawal' }
  | { ok: false; reason: 'policy'; policyReasons: MoneyPolicyReason[] };

/**
 * Клиент заявляет хэш. Один хэш — одна заявка навсегда (UNIQUE tx_hash).
 * Гонка двух заявок одного хэша разрешается базой: `ON CONFLICT` второй
 * вставки ждёт первую и видит строку уже `claimed` → отказ.
 * Неопознанное поступление (наблюдатель видел, никто не заявил) превращается
 * в заявку этого клиента атомарно — тем же `ON CONFLICT … WHERE`.
 */
export async function claimDeposit(
  pool: PoolLike,
  input: { userId: string; txHash: string },
): Promise<ClaimResult> {
  const txHash = normalizeTxHash(input.txHash);
  if (!txHash) return { ok: false, reason: 'invalidHash' };

  return inTransaction<ClaimResult>(pool, async (tx) => {
    const policy = computeMoneyPolicy(await loadMoneyPolicyInputs(tx, input.userId));
    if (!policy.depositAllowed) {
      return rollback<ClaimResult>({ ok: false, reason: 'policy', policyReasons: policy.depositReasons });
    }

    const usedOut = await tx.query(`SELECT 1 FROM crypto_withdrawals WHERE payout_tx_hash = $1`, [txHash]);
    if (usedOut.rows.length > 0) return rollback<ClaimResult>({ ok: false, reason: 'usedByWithdrawal' });

    const ins = await tx.query(
      `INSERT INTO crypto_deposits (user_id, tx_hash, status)
            VALUES ($1, $2, 'claimed')
       ON CONFLICT (tx_hash) DO UPDATE
             SET user_id = EXCLUDED.user_id, status = 'claimed', claimed_at = now(), updated_at = now()
           WHERE crypto_deposits.status = 'unidentified' AND crypto_deposits.user_id IS NULL
       RETURNING id, (xmax <> 0) AS was_update`,
      [input.userId, txHash],
    );
    const row = ins.rows[0];
    if (!row) return rollback<ClaimResult>({ ok: false, reason: 'alreadyClaimed' });

    const depositId = row.id as string;
    const fromUnidentified = Boolean(row.was_update);
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: SYSTEM_OPERATORS.cabinet,
        action: 'crypto.deposit.claimed',
        subjectKind: 'client',
        subjectId: input.userId,
        payload: { depositId, txHash, fromUnidentified },
      },
      tx,
    );
    await tx.query(`UPDATE crypto_deposits SET last_journal_seq = $2 WHERE id = $1`, [depositId, seq]);
    return { ok: true, depositId, fromUnidentified };
  });
}

/** Подтверждённый сетью перевод (то, что вернула сверка). */
export interface VerifiedTransfer {
  amountRaw: bigint;
  fromAddress: string;
  toAddress: string;
  blockTime: Date | null;
}

export type CreditResult =
  | { state: 'credited'; amountMinor: number; dustRaw: bigint }
  | { state: 'rejected'; reason: DepositRejectReason }
  | { state: 'skipped' }
  | { state: 'terminal-refused'; code: string }
  | { state: 'terminal-unavailable' };

function journalMoney(outcome: MoneyMoveOutcome): Record<string, unknown> {
  return outcome.state === 'ok'
    ? { terminalSeq: outcome.seq, balanceMinor: outcome.balanceMinor, replay: outcome.replay }
    : {};
}

/**
 * Зачислить заявленный депозит, который сеть подтвердила (наблюдатель).
 * Сумма: сырые единицы USDT → центы, дробь меньше цента вниз (записывается).
 * Ноль центов — `below_minimum` (зачислять нечего).
 */
export async function creditClaimedDeposit(
  pool: PoolLike,
  terminal: TerminalMoneyClient,
  input: { depositId: string; transfer: VerifiedTransfer; minDepositMinor: number },
): Promise<CreditResult> {
  return inTransaction<CreditResult>(pool, async (tx) => {
    const cur = await tx.query(
      `SELECT user_id, tx_hash, status FROM crypto_deposits WHERE id = $1 FOR UPDATE`,
      [input.depositId],
    );
    const row = cur.rows[0];
    if (!row || row.status !== 'claimed' || !row.user_id) return rollback<CreditResult>({ state: 'skipped' });
    const userId = row.user_id as string;
    const txHash = row.tx_hash as string;

    const { cents, dustRaw } = usdtRawToCents(input.transfer.amountRaw);
    const base = {
      from_address: input.transfer.fromAddress,
      to_address: input.transfer.toAddress,
      amount_raw: input.transfer.amountRaw.toString(),
      dust_raw: dustRaw.toString(),
      block_time: input.transfer.blockTime ? input.transfer.blockTime.toISOString() : null,
    };

    if (cents === 0n || cents < BigInt(input.minDepositMinor)) {
      await setRejected(tx, input.depositId, userId, txHash, 'below_minimum', base);
      return { state: 'rejected', reason: 'below_minimum' };
    }

    const outcome = await terminal.deposit(userId, {
      amount_minor: Number(cents),
      external_ref: externalRef.deposit(txHash),
      operator: 'site:chain-watcher',
      reason: `USDT TRC20 ${txHash}`,
    });
    if (outcome.state === 'refused') {
      await noteDeposit(tx, input.depositId, `терминал отказал: ${outcome.code}`);
      return { state: 'terminal-refused', code: outcome.code };
    }
    if (outcome.state === 'unavailable') {
      // Исход неизвестен — откатываемся; следующий проход повторит тем же ref.
      return rollback<CreditResult>({ state: 'terminal-unavailable' });
    }

    await tx.query(
      `UPDATE crypto_deposits
          SET status = 'credited', amount_minor = $2, from_address = $3, to_address = $4,
              amount_raw = $5, dust_raw = $6, block_time = $7, terminal_seq = $8,
              credited_at = now(), updated_at = now(), check_note = NULL, last_checked_at = now()
        WHERE id = $1 AND status = 'claimed'`,
      [
        input.depositId,
        Number(cents),
        base.from_address,
        base.to_address,
        base.amount_raw,
        base.dust_raw,
        base.block_time,
        outcome.seq,
      ],
    );
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: SYSTEM_OPERATORS.chainWatcher,
        action: 'crypto.deposit.credited',
        subjectKind: 'client',
        subjectId: userId,
        payload: {
          depositId: input.depositId,
          txHash,
          amountRaw: base.amount_raw,
          amountMinor: Number(cents),
          dustRaw: base.dust_raw,
          fromAddress: base.from_address,
          ...journalMoney(outcome),
        },
      },
      tx,
    );
    await tx.query(`UPDATE crypto_deposits SET last_journal_seq = $2 WHERE id = $1`, [input.depositId, seq]);
    return { state: 'credited', amountMinor: Number(cents), dustRaw };
  });
}

async function setRejected(
  tx: Queryable,
  depositId: string,
  userId: string,
  txHash: string,
  reason: DepositRejectReason,
  details: Record<string, unknown>,
): Promise<void> {
  await tx.query(
    `UPDATE crypto_deposits
        SET status = 'rejected', reject_reason = $2,
            from_address = COALESCE($3, from_address), to_address = COALESCE($4, to_address),
            amount_raw = COALESCE($5::numeric, amount_raw), dust_raw = COALESCE($6::numeric, dust_raw),
            updated_at = now(), last_checked_at = now()
      WHERE id = $1 AND status = 'claimed'`,
    [
      depositId,
      reason,
      (details.from_address as string | undefined) ?? null,
      (details.to_address as string | undefined) ?? null,
      (details.amount_raw as string | undefined) ?? null,
      (details.dust_raw as string | undefined) ?? null,
    ],
  );
  const seq = await appendJournalSeqWithinTx(
    {
      operatorId: SYSTEM_OPERATORS.chainWatcher,
      action: 'crypto.deposit.rejected',
      subjectKind: 'client',
      subjectId: userId,
      payload: { depositId, txHash, reason, ...details },
    },
    tx,
  );
  await tx.query(`UPDATE crypto_deposits SET last_journal_seq = $2 WHERE id = $1`, [depositId, seq]);
}

/** Отклонить заявку (сеть опровергла). Только из `claimed`. */
export async function rejectClaimedDeposit(
  pool: PoolLike,
  input: {
    depositId: string;
    reason: DepositRejectReason;
    fromAddress?: string | null;
    toAddress?: string | null;
    amountRaw?: bigint | null;
  },
): Promise<boolean> {
  return inTransaction<boolean>(pool, async (tx) => {
    const cur = await tx.query(
      `SELECT user_id, tx_hash, status FROM crypto_deposits WHERE id = $1 FOR UPDATE`,
      [input.depositId],
    );
    const row = cur.rows[0];
    if (!row || row.status !== 'claimed') return rollback(false);
    await setRejected(tx, input.depositId, row.user_id as string, row.tx_hash as string, input.reason, {
      ...(input.fromAddress ? { from_address: input.fromAddress } : {}),
      ...(input.toAddress ? { to_address: input.toAddress } : {}),
      ...(input.amountRaw !== undefined && input.amountRaw !== null
        ? { amount_raw: input.amountRaw.toString() }
        : {}),
    });
    return true;
  });
}

async function noteDeposit(tx: Queryable, depositId: string, note: string): Promise<void> {
  await tx.query(
    `UPDATE crypto_deposits SET check_note = $2, last_checked_at = now() WHERE id = $1`,
    [depositId, note.slice(0, 300)],
  );
}

/** Заметка «почему ещё ждём» — без смены статуса и без журнала (не переход). */
export async function noteDepositCheck(db: Queryable, depositId: string, note: string): Promise<void> {
  await noteDeposit(db, depositId, note);
}

export interface IncomingTransfer {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: bigint;
  blockTime: Date;
}

/**
 * Неопознанное поступление: наблюдатель видит входящий USDT, на который никто
 * не заявил хэш. Вставка идемпотентна (`ON CONFLICT DO NOTHING`): заявленный
 * клиентом хэш (любой статус) не трогается. Журнал — только при вставке.
 */
export async function recordUnidentified(pool: PoolLike, t: IncomingTransfer): Promise<boolean> {
  const txHash = normalizeTxHash(t.txHash);
  if (!txHash) return false;
  return inTransaction<boolean>(pool, async (tx) => {
    const ins = await tx.query(
      `INSERT INTO crypto_deposits
         (user_id, tx_hash, status, from_address, to_address, amount_raw, block_time)
       VALUES (NULL, $1, 'unidentified', $2, $3, $4, $5)
       ON CONFLICT (tx_hash) DO NOTHING
       RETURNING id`,
      [txHash, t.fromAddress, t.toAddress, t.amountRaw.toString(), t.blockTime.toISOString()],
    );
    const row = ins.rows[0];
    if (!row) return rollback(false);
    const depositId = row.id as string;
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: SYSTEM_OPERATORS.chainWatcher,
        action: 'crypto.deposit.unidentified',
        subjectKind: 'crypto_deposit',
        subjectId: depositId,
        payload: { txHash, fromAddress: t.fromAddress, amountRaw: t.amountRaw.toString() },
      },
      tx,
    );
    await tx.query(`UPDATE crypto_deposits SET last_journal_seq = $2 WHERE id = $1`, [depositId, seq]);
    return true;
  });
}

export type BindResult =
  | { ok: true; amountMinor: number }
  | {
      ok: false;
      reason:
        | 'missingReason'
        | 'noClient'
        | 'notUnidentified'
        | 'belowMinimum'
        | 'terminalUnavailable';
    }
  | { ok: false; reason: 'terminalRefused'; code: string };

/**
 * Оператор привязывает неопознанное поступление к клиенту с основанием:
 * терминал `deposit(tron:<hash>)` → `credited`, журнал `crypto.deposit.bound`.
 * Строка заперта на всё время вызова: параллельная заявка клиента на тот же
 * хэш дождётся и увидит, что поступление уже не неопознанное.
 */
export async function bindUnidentifiedDeposit(
  pool: PoolLike,
  terminal: TerminalMoneyClient,
  input: { depositId: string; userId: string; operatorId: string; operatorLogin: string; reason: string },
): Promise<BindResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'missingReason' };

  return inTransaction<BindResult>(pool, async (tx) => {
    const user = await tx.query(`SELECT 1 FROM users WHERE id = $1`, [input.userId]);
    if (user.rows.length === 0) return rollback<BindResult>({ ok: false, reason: 'noClient' });

    const cur = await tx.query(
      `SELECT tx_hash, status, user_id, amount_raw, from_address
         FROM crypto_deposits WHERE id = $1 FOR UPDATE`,
      [input.depositId],
    );
    const row = cur.rows[0];
    if (!row || row.status !== 'unidentified' || row.user_id !== null) {
      return rollback<BindResult>({ ok: false, reason: 'notUnidentified' });
    }
    const txHash = row.tx_hash as string;
    const { cents, dustRaw } = usdtRawToCents(String(row.amount_raw ?? '0'));
    if (cents === 0n) return rollback<BindResult>({ ok: false, reason: 'belowMinimum' });

    const outcome = await terminal.deposit(input.userId, {
      amount_minor: Number(cents),
      external_ref: externalRef.deposit(txHash),
      operator: input.operatorLogin,
      reason,
    });
    if (outcome.state === 'refused') {
      return rollback<BindResult>({ ok: false, reason: 'terminalRefused', code: outcome.code });
    }
    if (outcome.state === 'unavailable') {
      return rollback<BindResult>({ ok: false, reason: 'terminalUnavailable' });
    }

    await tx.query(
      `UPDATE crypto_deposits
          SET user_id = $2, status = 'credited', amount_minor = $3, dust_raw = $4,
              terminal_seq = $5, credited_at = now(), resolved_by = $6, updated_at = now()
        WHERE id = $1 AND status = 'unidentified' AND user_id IS NULL`,
      [input.depositId, input.userId, Number(cents), dustRaw.toString(), outcome.seq, input.operatorId],
    );
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: input.operatorId,
        action: 'crypto.deposit.bound',
        subjectKind: 'client',
        subjectId: input.userId,
        payload: {
          basis: reason,
          depositId: input.depositId,
          txHash,
          fromAddress: row.from_address ?? null,
          amountMinor: Number(cents),
          dustRaw: dustRaw.toString(),
          ...journalMoney(outcome),
        },
      },
      tx,
    );
    await tx.query(`UPDATE crypto_deposits SET last_journal_seq = $2 WHERE id = $1`, [input.depositId, seq]);
    return { ok: true, amountMinor: Number(cents) };
  });
}
