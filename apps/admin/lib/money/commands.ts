import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool } from '../db';
import { appendJournalEntry } from '../journal/journal';
import { requiresSecondApproval } from './config';
import { EnvEd25519KeyProvider, signMoneyCommand, type Ed25519KeyProvider } from './signing';
import { initialStateFor, transition } from './state-machine';
import type { MoneyAmount, MoneyCommandPayload, MoneyCommandState, MoneyCommandType } from './types';

/**
 * Оркестрация денежных команд dual control (Р-452) — персистентная надстройка
 * над чистой стейт-машиной. Образец — `kyc/decide.ts`: одно действие = одна
 * транзакция, и в ней НЕРАЗДЕЛИМО смена `state` + запись в неизменяемый журнал
 * (`appendJournalEntry`, Р-049) + привязка `last_journal_seq`. Либо всё, либо
 * ничего.
 *
 * ЭТО СКЕЛЕТ: деньги НЕ двигаются (Р-396), терминального (Rust) пути нет,
 * `dispatch`/`execute`/`reject` не ходят в живой терминал. `operatorId` берётся
 * из СЕССИИ вызывающим server action-ом, НЕ из формы (Р-451/Р-452).
 *
 * Гарды состоянием в UPDATE (`WHERE ... AND state = $ожидаемое`) — та же
 * оптимистичная блокировка состоянием, что в `decide.ts`: гонка двух операторов
 * → 0 строк → откат → fail-closed.
 */

export interface CommandDeps {
  pool?: { connect(): Promise<PoolClient> };
  /** Провайдер ключа ЦУ. По умолчанию из env; в тестах/Vault — свой. */
  keyProvider?: Ed25519KeyProvider;
}

export interface InitiateInput {
  /** `operators.id` инициатора — из сессии, НЕ из формы. */
  initiatorId: string;
  type: MoneyCommandType;
  accountId: string;
  amount: MoneyAmount;
  /** Основание: id заявки/тикета/инцидента. Непустое. */
  basisRef: string;
  /** Аварийный обход dual control (Р-452). Требует причину. */
  breakGlass?: boolean;
  breakGlassReason?: string;
}

export type InitiateResult =
  | { ok: true; commandId: string; state: MoneyCommandState; nonce: string }
  | { ok: false; reason: 'missingBasis' | 'missingBreakGlassReason' };

const SUBJECT = 'money_command';
/** Пост-фактум ревью break-glass ≤24ч (Р-452). */
const BREAK_GLASS_REVIEW_MS = 24 * 60 * 60 * 1000;

async function journal(
  client: PoolClient,
  operatorId: string,
  action: string,
  commandId: string,
  payload: Record<string, unknown>,
): Promise<number> {
  const entry = await appendJournalEntry(
    { operatorId, action, subjectKind: SUBJECT, subjectId: commandId, payload },
    client as unknown as Parameters<typeof appendJournalEntry>[1],
  );
  const seqRow = await client.query(`SELECT seq FROM admin_action_journal WHERE entry_hash = $1`, [
    entry.entryHash,
  ]);
  const seq = Number((seqRow.rows[0] as { seq: number | string } | undefined)?.seq);
  if (!Number.isFinite(seq)) throw new Error('не удалось получить seq записи журнала денежной команды');
  return seq;
}

/**
 * Инициация команды (Р-452). Создаёт команду в стартовом состоянии
 * (`initialStateFor`: `awaiting_second_approval`, если сумма выше порога и это
 * не break-glass, иначе `draft`), пишет аппрув-инициацию и журналирует.
 * Деньги НЕ двигаются — это намерение и его аудит.
 */
export async function initiateCommand(
  input: InitiateInput,
  deps: CommandDeps = {},
): Promise<InitiateResult> {
  const basisRef = input.basisRef?.trim() ?? '';
  if (basisRef.length === 0) return { ok: false, reason: 'missingBasis' };
  const breakGlass = input.breakGlass === true;
  const reason = input.breakGlassReason?.trim() ?? '';
  if (breakGlass && reason.length === 0) return { ok: false, reason: 'missingBreakGlassReason' };

  const pool = deps.pool ?? getPool();
  const commandId = randomUUID();
  const nonce = randomUUID();
  const state = initialStateFor(input.amount.amountMinor, breakGlass);
  const reviewDueAt = breakGlass ? new Date(Date.now() + BREAK_GLASS_REVIEW_MS).toISOString() : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO money_commands
         (id, type, account_id, amount_minor, currency, scale, initiator_id, basis_ref,
          nonce, state, break_glass, break_glass_reason, review_due_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        commandId,
        input.type,
        input.accountId,
        input.amount.amountMinor,
        input.amount.currency,
        input.amount.scale,
        input.initiatorId,
        basisRef,
        nonce,
        state,
        breakGlass,
        breakGlass ? reason : null,
        reviewDueAt,
      ],
    );
    await client.query(
      `INSERT INTO money_command_approvals (id, command_id, approver_id, kind)
       VALUES ($1,$2,$3,'initiate')`,
      [randomUUID(), commandId, input.initiatorId],
    );
    const seq = await journal(client, input.initiatorId, 'money.command.initiated', commandId, {
      type: input.type,
      accountId: input.accountId,
      amountMinor: input.amount.amountMinor,
      currency: input.amount.currency,
      scale: input.amount.scale,
      basisRef,
      state,
      breakGlass,
    });
    if (breakGlass) {
      await journal(client, input.initiatorId, 'money.command.break_glass', commandId, {
        reason,
        reviewDueAt,
      });
    }
    await client.query(`UPDATE money_commands SET last_journal_seq = $2 WHERE id = $1`, [
      commandId,
      seq,
    ]);
    await client.query('COMMIT');
    return { ok: true, commandId, state, nonce };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Общий результат переходов, двигающих уже созданную команду. */
export type StepResult =
  | { ok: true; state: MoneyCommandState }
  | { ok: false; reason: 'notFound' | 'illegalState' | 'selfApprovalForbidden' | 'secondApprovalRequired' };

interface LoadedCommand {
  id: string;
  state: MoneyCommandState;
  initiator_id: string;
  type: MoneyCommandType;
  account_id: string;
  amount_minor: string;
  currency: string;
  scale: number;
  basis_ref: string;
  nonce: string;
  break_glass: boolean;
}

async function load(client: PoolClient, commandId: string): Promise<LoadedCommand | null> {
  const r = await client.query(
    `SELECT id, state, initiator_id, type, account_id, amount_minor, currency, scale,
            basis_ref, nonce, break_glass
       FROM money_commands WHERE id = $1 FOR UPDATE`,
    [commandId],
  );
  return (r.rows[0] as LoadedCommand | undefined) ?? null;
}

/** Строит каноническую нагрузку из строки команды + свежей метки времени. */
function payloadOf(cmd: LoadedCommand, issuedAt: string): MoneyCommandPayload {
  return {
    commandId: cmd.id,
    type: cmd.type,
    accountId: cmd.account_id,
    amount: { amountMinor: String(cmd.amount_minor), currency: cmd.currency, scale: cmd.scale },
    initiatorId: cmd.initiator_id,
    basisRef: cmd.basis_ref,
    issuedAt,
    nonce: cmd.nonce,
  };
}

/**
 * Применяет подпись ЦУ к команде на переходе `→ signed` (из обоих путей:
 * `draft` ниже порога / break-glass, и `awaiting_second_approval` после второго
 * аппрува). Метка времени генерится ЗДЕСЬ, при подписи (дизайн §1), и входит в
 * подписанную нагрузку — одна точка истины времени.
 */
async function applySignature(
  client: PoolClient,
  cmd: LoadedCommand,
  keyProvider: Ed25519KeyProvider,
): Promise<void> {
  const issuedAt = new Date().toISOString();
  const signed = signMoneyCommand(payloadOf(cmd, issuedAt), keyProvider);
  await client.query(
    `UPDATE money_commands
        SET signature = $2, key_version = $3, issued_at = $4, updated_at = now()
      WHERE id = $1`,
    [cmd.id, signed.signature, signed.keyVersion, issuedAt],
  );
}

/**
 * Подпись команды ниже порога (или break-glass): `draft → signed`. Если сумма
 * выше порога и это не break-glass — отказ `secondApprovalRequired` (крупную в
 * обход второго аппрувера не подписать).
 */
export async function signCommand(commandId: string, deps: CommandDeps = {}): Promise<StepResult> {
  const pool = deps.pool ?? getPool();
  const keyProvider = deps.keyProvider ?? new EnvEd25519KeyProvider();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cmd = await load(client, commandId);
    if (!cmd) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'notFound' };
    }
    const t = transition(cmd.state, {
      kind: 'sign',
      amountMinor: cmd.amount_minor,
      breakGlass: cmd.break_glass,
    });
    if (!t.ok) {
      await client.query('ROLLBACK');
      return { ok: false, reason: t.error === 'secondApprovalRequired' ? 'secondApprovalRequired' : 'illegalState' };
    }
    const updated = await client.query(
      `UPDATE money_commands SET state = 'signed', updated_at = now()
        WHERE id = $1 AND state = 'draft' RETURNING id`,
      [commandId],
    );
    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'illegalState' };
    }
    await applySignature(client, cmd, keyProvider);
    const seq = await journal(client, cmd.initiator_id, 'money.command.signed', commandId, {
      keyVersion: keyProvider.keyVersion(),
      breakGlass: cmd.break_glass,
    });
    await client.query(`UPDATE money_commands SET last_journal_seq = $2 WHERE id = $1`, [commandId, seq]);
    await client.query('COMMIT');
    return { ok: true, state: 'signed' };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Второй аппрув (Р-452): `awaiting_second_approval → signed`. Гард self-approval
 * — подтверждающий ≠ инициатор (разные учётки). При успехе сразу подписывает
 * ключом ЦУ. Партиальный UNIQUE в схеме не даст одному оператору занять обе
 * роли — подпора к логическому гарду.
 */
export async function secondApprove(
  commandId: string,
  approverId: string,
  deps: CommandDeps = {},
): Promise<StepResult> {
  const pool = deps.pool ?? getPool();
  const keyProvider = deps.keyProvider ?? new EnvEd25519KeyProvider();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cmd = await load(client, commandId);
    if (!cmd) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'notFound' };
    }
    const t = transition(cmd.state, { kind: 'secondApprove', initiatorId: cmd.initiator_id, approverId });
    if (!t.ok) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        reason: t.error === 'selfApprovalForbidden' ? 'selfApprovalForbidden' : 'illegalState',
      };
    }
    const updated = await client.query(
      `UPDATE money_commands SET state = 'signed', updated_at = now()
        WHERE id = $1 AND state = 'awaiting_second_approval' RETURNING id`,
      [commandId],
    );
    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'illegalState' };
    }
    await client.query(
      `INSERT INTO money_command_approvals (id, command_id, approver_id, kind)
       VALUES ($1,$2,$3,'second_approval')`,
      [randomUUID(), commandId, approverId],
    );
    await applySignature(client, cmd, keyProvider);
    const seq = await journal(client, approverId, 'money.command.second_approved', commandId, {
      initiatorId: cmd.initiator_id,
      keyVersion: keyProvider.keyVersion(),
    });
    await client.query(`UPDATE money_commands SET last_journal_seq = $2 WHERE id = $1`, [commandId, seq]);
    await client.query('COMMIT');
    return { ok: true, state: 'signed' };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export { requiresSecondApproval };
