import type { PoolClient } from 'pg';
import { getPool } from '../db';
import { appendJournalEntry } from '../journal/journal';
import { MAX_TERMINAL_LEVERAGE, type Queryable } from '@broker/money';
import {
  changesForJournal,
  deliverToTerminal,
  leverageChanges,
  terminalLeverageSync,
  type LeverageTerminalSync,
  type TerminalSyncFailure,
} from './terminal-sync';

function badLeverage(value: number): boolean {
  return !Number.isInteger(value) || value < 1 || value > MAX_TERMINAL_LEVERAGE;
}

async function seqOfEntry(client: PoolClient, entryHash: string, what: string): Promise<number> {
  const seqRow = await client.query(`SELECT seq FROM admin_action_journal WHERE entry_hash = $1`, [
    entryHash,
  ]);
  const seq = Number((seqRow.rows[0] as { seq: number | string } | undefined)?.seq);
  if (!Number.isFinite(seq)) {
    await client.query('ROLLBACK');
    throw new Error(`не удалось получить seq записи журнала: ${what}`);
  }
  return seq;
}

async function defaultPortfolioKey(client: PoolClient): Promise<string | null> {
  const res = await client.query(
    `SELECT key FROM leverage_portfolios WHERE is_default ORDER BY key LIMIT 1`,
  );
  return res.rows[0] ? String((res.rows[0] as { key: string }).key) : null;
}

export interface SetClientPortfolioInput {
  operatorId: string;
  userId: string;
  portfolioKey: string;
  reason: string;
  operatorLogin?: string;
}

export type ClientLeverageResult =
  | { ok: true; journalSeq: number }
  | { ok: false; reason: 'missingReason' }
  | { ok: false; reason: 'invalidLeverage' }
  | { ok: false; reason: 'noClient' }
  | { ok: false; reason: 'noPortfolio' }
  | { ok: false; reason: 'noOverride' }
  | { ok: false; reason: 'alreadyInState' }
  | TerminalSyncFailure;

export async function setClientPortfolio(
  input: SetClientPortfolioInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
  sync: LeverageTerminalSync = terminalLeverageSync(),
): Promise<ClientLeverageResult> {
  const reason = input.reason?.trim() ?? '';
  if (reason.length === 0) return { ok: false, reason: 'missingReason' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const user = await client.query(`SELECT 1 FROM users WHERE id = $1`, [input.userId]);
    if (user.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'noClient' };
    }
    const portfolio = await client.query(`SELECT 1 FROM leverage_portfolios WHERE key = $1`, [
      input.portfolioKey,
    ]);
    if (portfolio.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'noPortfolio' };
    }

    const cur = await client.query(
      `SELECT portfolio_key FROM client_leverage WHERE user_id = $1 FOR UPDATE`,
      [input.userId],
    );
    const previousPortfolio = cur.rows[0]
      ? String((cur.rows[0] as { portfolio_key: string }).portfolio_key)
      : null;
    if (previousPortfolio === input.portfolioKey) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'alreadyInState' };
    }

    const before = await sync.read(client as unknown as Queryable, [input.userId]);
    await client.query(
      `INSERT INTO client_leverage (user_id, portfolio_key, updated_at)
            VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET portfolio_key = EXCLUDED.portfolio_key, updated_at = now()`,
      [input.userId, input.portfolioKey],
    );
    const changes = leverageChanges(before, await sync.read(client as unknown as Queryable, [input.userId]));

    const entry = await appendJournalEntry(
      {
        operatorId: input.operatorId,
        action: 'leverage.client_portfolio_set',
        subjectKind: 'client',
        subjectId: input.userId,
        payload: {
          basis: reason,
          previousPortfolio,
          newPortfolio: input.portfolioKey,
          terminalLeverage: changesForJournal(changes),
        },
      },
      client as unknown as Parameters<typeof appendJournalEntry>[1],
    );
    const journalSeq = await seqOfEntry(client, entry.entryHash, 'смена портфеля клиента');

    const failed = await deliverToTerminal(sync, changes, {
      reason,
      operatorLogin: input.operatorLogin ?? input.operatorId,
      journalSeq,
    });
    if (failed) {
      await client.query('ROLLBACK');
      return failed;
    }

    await client.query(`UPDATE client_leverage SET last_journal_seq = $2 WHERE user_id = $1`, [
      input.userId,
      journalSeq,
    ]);

    await client.query('COMMIT');
    return { ok: true, journalSeq };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export interface SetClientOverrideInput {
  operatorId: string;
  userId: string;
  leverage: number;
  reason: string;
  ticket: string;
  operatorLogin?: string;
}

export async function setClientOverride(
  input: SetClientOverrideInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
  sync: LeverageTerminalSync = terminalLeverageSync(),
): Promise<ClientLeverageResult> {
  const reason = input.reason?.trim() ?? '';
  const ticket = input.ticket?.trim() ?? '';
  if (reason.length === 0 || ticket.length === 0) return { ok: false, reason: 'missingReason' };
  if (badLeverage(input.leverage)) return { ok: false, reason: 'invalidLeverage' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const user = await client.query(`SELECT 1 FROM users WHERE id = $1`, [input.userId]);
    if (user.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'noClient' };
    }

    const cur = await client.query(
      `SELECT portfolio_key, override_leverage FROM client_leverage WHERE user_id = $1 FOR UPDATE`,
      [input.userId],
    );
    const existing = cur.rows[0] as { portfolio_key: string; override_leverage: number | null } | undefined;

    let portfolioKey = existing ? String(existing.portfolio_key) : null;
    if (!portfolioKey) {
      portfolioKey = await defaultPortfolioKey(client);
      if (!portfolioKey) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'noPortfolio' };
      }
    }
    const previousOverride =
      existing && existing.override_leverage !== null ? Number(existing.override_leverage) : null;
    const before = await sync.read(client as unknown as Queryable, [input.userId]);

    await client.query(
      `INSERT INTO client_leverage
            (user_id, portfolio_key, override_leverage, override_reason, override_ticket, override_by, override_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, now(), now())
       ON CONFLICT (user_id) DO UPDATE
          SET override_leverage = EXCLUDED.override_leverage,
              override_reason   = EXCLUDED.override_reason,
              override_ticket   = EXCLUDED.override_ticket,
              override_by       = EXCLUDED.override_by,
              override_at       = now(),
              updated_at        = now()`,
      [input.userId, portfolioKey, input.leverage, reason, ticket, input.operatorId],
    );
    const changes = leverageChanges(before, await sync.read(client as unknown as Queryable, [input.userId]));

    const entry = await appendJournalEntry(
      {
        operatorId: input.operatorId,
        action: 'leverage.override_set',
        subjectKind: 'client',
        subjectId: input.userId,
        payload: {
          basis: reason,
          ticket,
          newLeverage: input.leverage,
          previousOverride,
          terminalLeverage: changesForJournal(changes),
        },
      },
      client as unknown as Parameters<typeof appendJournalEntry>[1],
    );
    const journalSeq = await seqOfEntry(client, entry.entryHash, 'выдача override клиенту');

    const failed = await deliverToTerminal(sync, changes, {
      reason,
      operatorLogin: input.operatorLogin ?? input.operatorId,
      journalSeq,
    });
    if (failed) {
      await client.query('ROLLBACK');
      return failed;
    }

    await client.query(`UPDATE client_leverage SET last_journal_seq = $2 WHERE user_id = $1`, [
      input.userId,
      journalSeq,
    ]);

    await client.query('COMMIT');
    return { ok: true, journalSeq };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export interface ClearClientOverrideInput {
  operatorId: string;
  userId: string;
  reason: string;
  operatorLogin?: string;
}

export async function clearClientOverride(
  input: ClearClientOverrideInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
  sync: LeverageTerminalSync = terminalLeverageSync(),
): Promise<ClientLeverageResult> {
  const reason = input.reason?.trim() ?? '';
  if (reason.length === 0) return { ok: false, reason: 'missingReason' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cur = await client.query(
      `SELECT override_leverage FROM client_leverage WHERE user_id = $1 FOR UPDATE`,
      [input.userId],
    );
    const existing = cur.rows[0] as { override_leverage: number | null } | undefined;
    if (!existing || existing.override_leverage === null) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'noOverride' };
    }
    const previousOverride = Number(existing.override_leverage);
    const before = await sync.read(client as unknown as Queryable, [input.userId]);

    await client.query(
      `UPDATE client_leverage
          SET override_leverage = NULL, override_reason = NULL, override_ticket = NULL,
              override_by = NULL, override_at = NULL, updated_at = now()
        WHERE user_id = $1`,
      [input.userId],
    );
    const changes = leverageChanges(before, await sync.read(client as unknown as Queryable, [input.userId]));

    const entry = await appendJournalEntry(
      {
        operatorId: input.operatorId,
        action: 'leverage.override_cleared',
        subjectKind: 'client',
        subjectId: input.userId,
        payload: { basis: reason, previousOverride, terminalLeverage: changesForJournal(changes) },
      },
      client as unknown as Parameters<typeof appendJournalEntry>[1],
    );
    const journalSeq = await seqOfEntry(client, entry.entryHash, 'снятие override клиента');

    const failed = await deliverToTerminal(sync, changes, {
      reason,
      operatorLogin: input.operatorLogin ?? input.operatorId,
      journalSeq,
    });
    if (failed) {
      await client.query('ROLLBACK');
      return failed;
    }

    await client.query(`UPDATE client_leverage SET last_journal_seq = $2 WHERE user_id = $1`, [
      input.userId,
      journalSeq,
    ]);

    await client.query('COMMIT');
    return { ok: true, journalSeq };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
