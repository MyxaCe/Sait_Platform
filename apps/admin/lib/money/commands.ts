import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool } from '../db';
import { appendJournalEntry } from '../journal/journal';
import {
  buildMoneyAlert,
  noopBreakGlassAlert,
  type BreakGlassAlertPort,
} from './alerts';
import { requiresSecondApproval } from './config';
import { EnvEd25519KeyProvider, signMoneyCommand, type Ed25519KeyProvider } from './signing';
import { initialStateFor, transition } from './state-machine';
import {
  isMoneyInitiatorRole,
  type MoneyAmount,
  type MoneyCommandPayload,
  type MoneyCommandState,
  type MoneyCommandType,
  type MoneyInitiatorRole,
} from './types';

/**
 * Оркестрация денежных команд dual control (Р-452, ратификация Р-455) —
 * персистентная надстройка над чистой стейт-машиной. Образец — `kyc/decide.ts`:
 * одно действие = одна транзакция, и в ней НЕРАЗДЕЛИМО смена `state` + запись в
 * неизменяемый журнал (`appendJournalEntry`, Р-049) + привязка
 * `last_journal_seq`. Либо всё, либо ничего.
 *
 * ЭТО СКЕЛЕТ: деньги НЕ двигаются (Р-396), терминального (Rust) пути нет,
 * `dispatch`/`execute`/`reject` не ходят в живой терминал. `initiatorId`/роль
 * берутся из СЕССИИ вызывающим server action-ом, НЕ из формы (Р-451/Р-452).
 *
 * Ратификация Р-455:
 *  - R-1: одна подпись ЦУ; в подписываемый payload кладём id ОБОИХ аппрувов.
 *  - R-2 + поправка: порог=0 для finance_operator; admin ПОЛНОСТЬЮ освобождён
 *    от второго аппрува (draft → signed сразу, любая сумма).
 *  - R-3: инициируют admin и finance_operator; self-approval запрещён.
 *  - R-4: reversal обязан ссылаться на исходную команду.
 *  - R-5: break-glass — только admin, инцидент, алерт всем админам, ревью ≤24ч.
 *
 * Гарды состоянием в UPDATE (`WHERE ... AND state = $ожидаемое`) — оптимистичная
 * блокировка состоянием, что в `decide.ts`: гонка двух операторов → 0 строк →
 * откат → fail-closed.
 */

export interface CommandDeps {
  pool?: { connect(): Promise<PoolClient> };
  /** Провайдер ключа ЦУ. По умолчанию из env; в тестах/Vault — свой. */
  keyProvider?: Ed25519KeyProvider;
  /** Порт алерта всех админов при break-glass (Р-455 R-5). По умолчанию no-op. */
  breakGlassAlert?: BreakGlassAlertPort;
}

export interface InitiateInput {
  /** `operators.id` инициатора — из сессии, НЕ из формы. */
  initiatorId: string;
  /** Роль инициатора — из сессии (Р-455 R-2/R-3): admin | finance_operator. */
  initiatorRole: MoneyInitiatorRole;
  type: MoneyCommandType;
  accountId: string;
  amount: MoneyAmount;
  /** Основание: id заявки/тикета/инцидента. Непустое. */
  basisRef: string;
  /** Р-455 R-4: для `reversal` — id исходной команды (обязателен для reversal). */
  originalCommandId?: string;
  /** Аварийный обход (Р-455 R-5). Только admin; требует причину и инцидент. */
  breakGlass?: boolean;
  breakGlassReason?: string;
  /** Р-455 R-5: инцидент, к которому привязана break-glass команда. */
  incidentRef?: string;
}

export type InitiateResult =
  | { ok: true; commandId: string; state: MoneyCommandState; nonce: string }
  | {
      ok: false;
      reason:
        | 'missingBasis'
        | 'forbiddenRole'
        | 'missingOriginalCommand'
        | 'breakGlassAdminOnly'
        | 'missingBreakGlassReason'
        | 'missingIncident';
    };

const SUBJECT = 'money_command';
/** Пост-фактум ревью break-glass ≤24ч (Р-452/Р-455 R-5). */
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
 * Инициация команды (Р-452, Р-455). Создаёт команду в стартовом состоянии
 * (`initialStateFor` по РОЛИ: admin → `draft` всегда; finance_operator →
 * `awaiting_second_approval`, если сумма выше порога), пишет аппрув-инициацию и
 * журналирует. Деньги НЕ двигаются — это намерение и его аудит.
 */
export async function initiateCommand(
  input: InitiateInput,
  deps: CommandDeps = {},
): Promise<InitiateResult> {
  // Р-455 R-3: деньги инициируют только admin/finance_operator (не plain operator).
  if (!isMoneyInitiatorRole(input.initiatorRole)) return { ok: false, reason: 'forbiddenRole' };

  const basisRef = input.basisRef?.trim() ?? '';
  if (basisRef.length === 0) return { ok: false, reason: 'missingBasis' };

  // Р-455 R-4: reversal без ссылки на исходную команду — это не reversal.
  const originalCommandId = input.originalCommandId?.trim() ?? '';
  if (input.type === 'reversal' && originalCommandId.length === 0) {
    return { ok: false, reason: 'missingOriginalCommand' };
  }

  const breakGlass = input.breakGlass === true;
  const reason = input.breakGlassReason?.trim() ?? '';
  const incidentRef = input.incidentRef?.trim() ?? '';
  if (breakGlass) {
    // Р-455 R-5: break-glass — ТОЛЬКО admin.
    if (input.initiatorRole !== 'admin') return { ok: false, reason: 'breakGlassAdminOnly' };
    if (reason.length === 0) return { ok: false, reason: 'missingBreakGlassReason' };
    if (incidentRef.length === 0) return { ok: false, reason: 'missingIncident' };
  }

  const pool = deps.pool ?? getPool();
  const alertPort = deps.breakGlassAlert ?? noopBreakGlassAlert;
  const commandId = randomUUID();
  const nonce = randomUUID();
  const initiateApprovalId = randomUUID();
  const state = initialStateFor(input.initiatorRole, input.amount.amountMinor, breakGlass);
  const reviewDueAt = breakGlass ? new Date(Date.now() + BREAK_GLASS_REVIEW_MS).toISOString() : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO money_commands
         (id, type, account_id, amount_minor, currency, scale, initiator_id, initiator_role,
          basis_ref, original_command_id, nonce, state, break_glass, break_glass_reason,
          incident_ref, review_due_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        commandId,
        input.type,
        input.accountId,
        input.amount.amountMinor,
        input.amount.currency,
        input.amount.scale,
        input.initiatorId,
        input.initiatorRole,
        basisRef,
        input.type === 'reversal' ? originalCommandId : null,
        nonce,
        state,
        breakGlass,
        breakGlass ? reason : null,
        breakGlass ? incidentRef : null,
        reviewDueAt,
      ],
    );
    await client.query(
      `INSERT INTO money_command_approvals (id, command_id, approver_id, kind)
       VALUES ($1,$2,$3,'initiate')`,
      [initiateApprovalId, commandId, input.initiatorId],
    );
    const seq = await journal(client, input.initiatorId, 'money.command.initiated', commandId, {
      type: input.type,
      accountId: input.accountId,
      amountMinor: input.amount.amountMinor,
      currency: input.amount.currency,
      scale: input.amount.scale,
      initiatorRole: input.initiatorRole,
      basisRef,
      originalCommandId: input.type === 'reversal' ? originalCommandId : null,
      initiateApprovalId,
      state,
      breakGlass,
    });
    if (breakGlass) {
      await journal(client, input.initiatorId, 'money.command.break_glass', commandId, {
        reason,
        incidentRef,
        reviewDueAt,
      });
    }
    await client.query(`UPDATE money_commands SET last_journal_seq = $2 WHERE id = $1`, [
      commandId,
      seq,
    ]);
    await client.query('COMMIT');

    // Р-455 R-5: немедленный алерт ВСЕМ админам — ПОСЛЕ коммита (не алертим о
    // команде, которая откатилась). Порт по умолчанию no-op; сбой канала не
    // роняет уже совершённую инициацию.
    if (breakGlass) {
      const alert = buildMoneyAlert({
        kind: 'break_glass',
        commandId,
        type: input.type,
        accountId: input.accountId,
        amount: input.amount,
        initiatorId: input.initiatorId,
        secondApproverId: null,
        basisRef,
        result: `break-glass: ${reason}`,
        breakGlass: true,
        incidentRef,
      });
      await alertPort.alertAllAdmins(alert).catch(() => {});
    }

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
  initiator_role: MoneyInitiatorRole;
  type: MoneyCommandType;
  account_id: string;
  amount_minor: string;
  currency: string;
  scale: number;
  basis_ref: string;
  original_command_id: string | null;
  nonce: string;
  break_glass: boolean;
}

async function load(client: PoolClient, commandId: string): Promise<LoadedCommand | null> {
  const r = await client.query(
    `SELECT id, state, initiator_id, initiator_role, type, account_id, amount_minor, currency,
            scale, basis_ref, original_command_id, nonce, break_glass
       FROM money_commands WHERE id = $1 FOR UPDATE`,
    [commandId],
  );
  return (r.rows[0] as LoadedCommand | undefined) ?? null;
}

/**
 * Читает id аппрувов команды (Р-455 R-1): инициация обязательна, второй аппрув
 * — по наличию (null для admin-пути). Нужны, чтобы вложить оба id в подпись.
 */
async function approvalIds(
  client: PoolClient,
  commandId: string,
): Promise<{ initiateApprovalId: string; secondApprovalId: string | null }> {
  const r = await client.query(
    `SELECT kind, id FROM money_command_approvals WHERE command_id = $1`,
    [commandId],
  );
  const rows = r.rows as Array<{ kind: 'initiate' | 'second_approval'; id: string }>;
  const initiate = rows.find((x) => x.kind === 'initiate')?.id;
  if (!initiate) throw new Error('аппрув-инициация не найден — подпись без аппрува запрещена (Р-455 R-1)');
  const second = rows.find((x) => x.kind === 'second_approval')?.id ?? null;
  return { initiateApprovalId: initiate, secondApprovalId: second };
}

/** Строит каноническую нагрузку из строки команды + свежей метки + id аппрувов. */
function payloadOf(
  cmd: LoadedCommand,
  issuedAt: string,
  approvals: { initiateApprovalId: string; secondApprovalId: string | null },
): MoneyCommandPayload {
  return {
    commandId: cmd.id,
    type: cmd.type,
    accountId: cmd.account_id,
    amount: { amountMinor: String(cmd.amount_minor), currency: cmd.currency, scale: cmd.scale },
    initiatorId: cmd.initiator_id,
    basisRef: cmd.basis_ref,
    originalCommandId: cmd.original_command_id,
    initiateApprovalId: approvals.initiateApprovalId,
    secondApprovalId: approvals.secondApprovalId,
    issuedAt,
    nonce: cmd.nonce,
  };
}

/**
 * Применяет подпись ЦУ к команде на переходе `→ signed`. Метка времени (Р-455
 * R-6) генерится ЗДЕСЬ, ПОСЛЕ сбора аппрувов, и входит в подписанную нагрузку
 * вместе с id обоих аппрувов (Р-455 R-1) — одна точка истины.
 */
async function applySignature(
  client: PoolClient,
  cmd: LoadedCommand,
  keyProvider: Ed25519KeyProvider,
): Promise<void> {
  const issuedAt = new Date().toISOString();
  const approvals = await approvalIds(client, cmd.id);
  const signed = signMoneyCommand(payloadOf(cmd, issuedAt, approvals), keyProvider);
  await client.query(
    `UPDATE money_commands
        SET signature = $2, key_version = $3, issued_at = $4, updated_at = now()
      WHERE id = $1`,
    [cmd.id, signed.signature, signed.keyVersion, issuedAt],
  );
}

/**
 * Подпись команды, стоящей в `draft`: `draft → signed`. Для admin — всегда
 * (Р-455 R-2-поправка). Для finance_operator из draft — только если второй
 * аппрув не требуется (при пороге 0 он сюда не попадёт); иначе
 * `secondApprovalRequired`.
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
      role: cmd.initiator_role,
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
      initiatorRole: cmd.initiator_role,
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
 * Второй аппрув (Р-452/Р-455 R-3): `awaiting_second_approval → signed`. Гард
 * self-approval — подтверждающий ≠ инициатор (разные учётки). При успехе сразу
 * подписывает ключом ЦУ. Партиальный UNIQUE в схеме не даёт одному оператору
 * занять обе роли — подпора к логическому гарду.
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

export type ReviewResult =
  | { ok: true }
  | { ok: false; reason: 'notFound' | 'notBreakGlass' | 'alreadyReviewed' | 'missingResult' };

/**
 * Пост-фактум ревью break-glass команды (Р-455 R-5): фиксирует результат и
 * ревьюера, пишет в журнал той же транзакцией. Гард `reviewed_at IS NULL` не
 * даёт ревьюировать дважды. Скелет: срок ≤24ч задан `review_due_at`; живого
 * алерта о просрочке тут нет (порт).
 */
export async function reviewBreakGlass(
  commandId: string,
  reviewerId: string,
  result: string,
  deps: CommandDeps = {},
): Promise<ReviewResult> {
  const trimmed = result?.trim() ?? '';
  if (trimmed.length === 0) return { ok: false, reason: 'missingResult' };
  const pool = deps.pool ?? getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT id, break_glass, reviewed_at FROM money_commands WHERE id = $1 FOR UPDATE`,
      [commandId],
    );
    const row = r.rows[0] as { break_glass: boolean; reviewed_at: string | null } | undefined;
    if (!row) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'notFound' };
    }
    if (!row.break_glass) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'notBreakGlass' };
    }
    if (row.reviewed_at) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'alreadyReviewed' };
    }
    const updated = await client.query(
      `UPDATE money_commands
          SET reviewed_at = now(), reviewed_by = $2, review_result = $3, updated_at = now()
        WHERE id = $1 AND break_glass = true AND reviewed_at IS NULL RETURNING id`,
      [commandId, reviewerId, trimmed],
    );
    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'alreadyReviewed' };
    }
    const seq = await journal(client, reviewerId, 'money.command.break_glass_reviewed', commandId, {
      result: trimmed,
    });
    await client.query(`UPDATE money_commands SET last_journal_seq = $2 WHERE id = $1`, [commandId, seq]);
    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export { requiresSecondApproval };
