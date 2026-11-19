import type { PoolClient } from 'pg';
import type { MoneyMoveOutcome } from '@broker/money';
import { getPool } from '../db';
import {
  initiateCommand,
  journal,
  secondApprove,
  signCommand,
  type CommandDeps,
} from './commands';
import { EnvEd25519KeyProvider } from './signing';
import { transition } from './state-machine';
import { isMoneyInitiatorRole, type MoneyCommandState } from './types';

export const MANUAL_CREDIT_CURRENCY = 'USDT';
export const MANUAL_CREDIT_SCALE = 2;

export const manualCreditRef = (commandId: string) => `cmd:${commandId}`;

export interface CreditTerminal {
  deposit(
    userId: string,
    body: { amount_minor: number; external_ref: string; operator: string; reason: string },
  ): Promise<MoneyMoveOutcome>;
}

export interface ManualCreditDeps extends CommandDeps {
  terminal: CreditTerminal;
}

export interface CreditActor {
  operatorId: string;
  role: string | null | undefined;
  login: string;
}

export type ExecuteResult =
  | { ok: true; state: 'executed'; replay: boolean; terminalSeq: number | null }
  | { ok: false; reason: 'terminalRefused'; code: string }
  | { ok: false; reason: 'terminalUnavailable'; detail: string }
  | { ok: false; reason: 'notFound' | 'illegalState' | 'unsupportedType' };

export type ManualCreditFailure =
  | 'forbidden'
  | 'forbiddenRole'
  | 'missingBasis'
  | 'invalidAmount'
  | 'noClient'
  | 'signingKeyMissing'
  | 'notFound'
  | 'illegalState'
  | 'unsupportedType'
  | 'selfApprovalForbidden'
  | 'secondApprovalRequired'
  | 'missingOriginalCommand'
  | 'breakGlassAdminOnly'
  | 'missingBreakGlassReason'
  | 'missingIncident';

export type ManualCreditResult =
  | { ok: true; commandId: string; state: 'executed' | 'awaiting_second_approval'; replay?: boolean }
  | { ok: false; commandId?: string; reason: 'terminalRefused'; code: string }
  | { ok: false; commandId?: string; reason: 'terminalUnavailable'; detail: string }
  | { ok: false; commandId?: string; reason: ManualCreditFailure };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function poolOf(deps: CommandDeps) {
  return deps.pool ?? getPool();
}

function signingKeyReady(deps: CommandDeps): boolean {
  try {
    (deps.keyProvider ?? new EnvEd25519KeyProvider()).privateKey();
    return true;
  } catch {
    return false;
  }
}

async function clientExists(deps: CommandDeps, userId: string): Promise<boolean> {
  if (!UUID_RE.test(userId)) return false;
  const client = await poolOf(deps).connect();
  try {
    const r = await client.query(`SELECT 1 FROM users WHERE id = $1`, [userId]);
    return r.rows.length > 0;
  } finally {
    client.release();
  }
}

interface ExecRow {
  id: string;
  state: MoneyCommandState;
  type: string;
  account_id: string;
  amount_minor: string;
  currency: string;
  basis_ref: string;
  dispatch_attempts: number;
}

async function settle(
  client: PoolClient,
  actor: CreditActor,
  cmd: ExecRow,
  outcome: MoneyMoveOutcome,
  note: string | null,
): Promise<ExecuteResult> {
  const attempt = Number(cmd.dispatch_attempts ?? 0) + 1;
  const common = {
    accountId: cmd.account_id,
    amountMinor: String(cmd.amount_minor),
    currency: cmd.currency,
    externalRef: manualCreditRef(cmd.id),
    attempt,
    ...(note ? { basis: note } : { basis: cmd.basis_ref }),
  };
  let result: ExecuteResult;
  let seq: number;
  if (outcome.state === 'ok') {
    const t = transition('dispatched', { kind: 'execute' });
    if (!t.ok) throw new Error('переход dispatched → executed запрещён стейт-машиной');
    await client.query(
      `UPDATE money_commands
          SET state = 'executed', terminal_seq = $2, executed_at = now(), result_code = NULL,
              result_detail = NULL, dispatch_attempts = $3, updated_at = now()
        WHERE id = $1`,
      [cmd.id, outcome.seq, attempt],
    );
    seq = await journal(client, actor.operatorId, 'money.command.executed', cmd.id, {
      ...common,
      terminalSeq: outcome.seq,
      balanceMinor: outcome.balanceMinor,
      replay: outcome.replay,
    });
    result = { ok: true, state: 'executed', replay: outcome.replay, terminalSeq: outcome.seq };
  } else if (outcome.state === 'refused') {
    const t = transition('dispatched', { kind: 'reject' });
    if (!t.ok) throw new Error('переход dispatched → rejected запрещён стейт-машиной');
    await client.query(
      `UPDATE money_commands
          SET state = 'rejected', result_code = $2, result_detail = $3, dispatch_attempts = $4, updated_at = now()
        WHERE id = $1`,
      [cmd.id, outcome.code, String(outcome.status), attempt],
    );
    seq = await journal(client, actor.operatorId, 'money.command.terminal_refused', cmd.id, {
      ...common,
      code: outcome.code,
      status: outcome.status,
    });
    result = { ok: false, reason: 'terminalRefused', code: outcome.code };
  } else {
    await client.query(
      `UPDATE money_commands
          SET state = 'dispatched', result_code = 'unavailable', result_detail = $2,
              dispatch_attempts = $3, updated_at = now()
        WHERE id = $1`,
      [cmd.id, outcome.reason, attempt],
    );
    seq = await journal(client, actor.operatorId, 'money.command.terminal_unavailable', cmd.id, {
      ...common,
      reason: outcome.reason,
    });
    result = { ok: false, reason: 'terminalUnavailable', detail: outcome.reason };
  }
  await client.query(`UPDATE money_commands SET last_journal_seq = $2 WHERE id = $1`, [cmd.id, seq]);
  return result;
}

export async function executeCommand(
  commandId: string,
  actor: CreditActor,
  deps: ManualCreditDeps,
  note?: string,
): Promise<ExecuteResult> {
  const client = await poolOf(deps).connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT id, state, type, account_id, amount_minor, currency, basis_ref, dispatch_attempts
         FROM money_commands WHERE id = $1 FOR UPDATE`,
      [commandId],
    );
    const cmd = r.rows[0] as ExecRow | undefined;
    if (!cmd) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'notFound' };
    }
    if (cmd.type !== 'credit') {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'unsupportedType' };
    }
    if (cmd.state !== 'signed' && cmd.state !== 'dispatched') {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'illegalState' };
    }
    if (cmd.state === 'signed') {
      const t = transition('signed', { kind: 'dispatch' });
      if (!t.ok) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'illegalState' };
      }
    }
    const outcome = await deps.terminal.deposit(cmd.account_id, {
      amount_minor: Number(cmd.amount_minor),
      external_ref: manualCreditRef(cmd.id),
      operator: actor.login,
      reason: cmd.basis_ref,
    });
    const result = await settle(client, actor, cmd, outcome, note?.trim() || null);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function fromExecute(commandId: string, r: ExecuteResult): ManualCreditResult {
  if (r.ok) return { ok: true, commandId, state: 'executed', replay: r.replay };
  return { ...r, commandId };
}

export async function initiateManualCredit(
  input: { actor: CreditActor; userId: string; amountMinor: number; basis: string },
  deps: ManualCreditDeps,
): Promise<ManualCreditResult> {
  const { actor } = input;
  if (!isMoneyInitiatorRole(actor.role)) return { ok: false, reason: 'forbidden' };
  const basis = input.basis?.trim() ?? '';
  if (!basis) return { ok: false, reason: 'missingBasis' };
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    return { ok: false, reason: 'invalidAmount' };
  }
  if (!(await clientExists(deps, input.userId))) return { ok: false, reason: 'noClient' };
  if (!signingKeyReady(deps)) return { ok: false, reason: 'signingKeyMissing' };

  const init = await initiateCommand(
    {
      initiatorId: actor.operatorId,
      initiatorRole: actor.role,
      type: 'credit',
      accountId: input.userId,
      amount: {
        amountMinor: String(input.amountMinor),
        currency: MANUAL_CREDIT_CURRENCY,
        scale: MANUAL_CREDIT_SCALE,
      },
      basisRef: basis,
    },
    deps,
  );
  if (!init.ok) return { ok: false, reason: init.reason };
  if (init.state === 'awaiting_second_approval') {
    return { ok: true, commandId: init.commandId, state: 'awaiting_second_approval' };
  }
  const signed = await signCommand(init.commandId, deps);
  if (!signed.ok) return { ok: false, commandId: init.commandId, reason: signed.reason };
  return fromExecute(init.commandId, await executeCommand(init.commandId, actor, deps));
}

export async function approveManualCredit(
  input: { actor: CreditActor; commandId: string; note: string },
  deps: ManualCreditDeps,
): Promise<ManualCreditResult> {
  const { actor, commandId } = input;
  if (!isMoneyInitiatorRole(actor.role)) return { ok: false, reason: 'forbidden' };
  if (!input.note?.trim()) return { ok: false, reason: 'missingBasis' };
  if (!UUID_RE.test(commandId)) return { ok: false, reason: 'notFound' };
  if (!signingKeyReady(deps)) return { ok: false, reason: 'signingKeyMissing' };
  const approved = await secondApprove(commandId, actor.operatorId, deps, input.note);
  if (!approved.ok) return { ok: false, commandId, reason: approved.reason };
  return fromExecute(commandId, await executeCommand(commandId, actor, deps));
}

export async function retryManualCredit(
  input: { actor: CreditActor; commandId: string; note: string },
  deps: ManualCreditDeps,
): Promise<ManualCreditResult> {
  const { actor, commandId } = input;
  if (!isMoneyInitiatorRole(actor.role)) return { ok: false, reason: 'forbidden' };
  if (!input.note?.trim()) return { ok: false, reason: 'missingBasis' };
  if (!UUID_RE.test(commandId)) return { ok: false, reason: 'notFound' };
  return fromExecute(commandId, await executeCommand(commandId, actor, deps, input.note));
}

export type DeclineResult =
  | { ok: true }
  | { ok: false; reason: 'forbidden' | 'missingBasis' | 'notFound' | 'illegalState' };

export async function declineManualCredit(
  input: { actor: CreditActor; commandId: string; reason: string },
  deps: CommandDeps = {},
): Promise<DeclineResult> {
  const { actor, commandId } = input;
  if (!isMoneyInitiatorRole(actor.role)) return { ok: false, reason: 'forbidden' };
  const reason = input.reason?.trim() ?? '';
  if (!reason) return { ok: false, reason: 'missingBasis' };
  if (!UUID_RE.test(commandId)) return { ok: false, reason: 'notFound' };
  const client = await poolOf(deps).connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT id, state, initiator_id FROM money_commands WHERE id = $1 FOR UPDATE`,
      [commandId],
    );
    const cmd = r.rows[0] as { id: string; state: MoneyCommandState; initiator_id: string } | undefined;
    if (!cmd) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'notFound' };
    }
    const t = transition(cmd.state, { kind: 'decline' });
    if (!t.ok) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'illegalState' };
    }
    const updated = await client.query(
      `UPDATE money_commands
          SET state = 'rejected', result_code = 'declined', result_detail = $2, decided_by = $3, updated_at = now()
        WHERE id = $1 AND state = 'awaiting_second_approval' RETURNING id`,
      [commandId, reason, actor.operatorId],
    );
    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'illegalState' };
    }
    const seq = await journal(client, actor.operatorId, 'money.command.declined', commandId, {
      basis: reason,
      initiatorId: cmd.initiator_id,
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
