import type { PoolClient } from 'pg';
import { getPool } from '../db';
import { appendJournalEntry } from '../journal/journal';
import { isLeverageClass, LEVERAGE_CLASSES, MAX_TERMINAL_LEVERAGE, type Queryable } from '@broker/money';
import {
  changesForJournal,
  deliverToTerminal,
  leverageChanges,
  terminalLeverageSync,
  type LeverageTerminalSync,
  type TerminalSyncFailure,
} from './terminal-sync';

export interface ChangePortfolioInput {
  operatorId: string;
  portfolioKey: string;
  baseLeverage: number;
  reason: string;
  operatorLogin?: string;
}

export type PortfolioMutationResult =
  | { ok: true; journalSeq: number }
  | { ok: false; reason: 'missingReason' }
  | { ok: false; reason: 'invalidLeverage' }
  | { ok: false; reason: 'invalidClass' }
  | { ok: false; reason: 'noPortfolio' }
  | { ok: false; reason: 'alreadyInState' }
  | TerminalSyncFailure;

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

export async function changePortfolioLeverage(
  input: ChangePortfolioInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
  sync: LeverageTerminalSync = terminalLeverageSync(),
): Promise<PortfolioMutationResult> {
  const reason = input.reason?.trim() ?? '';
  if (reason.length === 0) return { ok: false, reason: 'missingReason' };
  if (badLeverage(input.baseLeverage)) return { ok: false, reason: 'invalidLeverage' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cur = await client.query(
      `SELECT base_leverage FROM leverage_portfolios WHERE key = $1 FOR UPDATE`,
      [input.portfolioKey],
    );
    if (cur.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'noPortfolio' };
    }
    const previousBase = Number((cur.rows[0] as { base_leverage: number | string }).base_leverage);
    if (previousBase === input.baseLeverage) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'alreadyInState' };
    }

    const q = client as unknown as Queryable;
    const users = await sync.usersOfPortfolio(q, input.portfolioKey);
    const before = await sync.read(q, users);
    await client.query(
      `UPDATE leverage_portfolios SET base_leverage = $2, updated_at = now() WHERE key = $1`,
      [input.portfolioKey, input.baseLeverage],
    );
    const changes = leverageChanges(before, await sync.read(q, users));

    const entry = await appendJournalEntry(
      {
        operatorId: input.operatorId,
        action: 'leverage.portfolio_changed',
        subjectKind: 'leverage_portfolio',
        subjectId: input.portfolioKey,
        payload: {
          basis: reason,
          previousBase,
          newBase: input.baseLeverage,
          terminalLeverage: changesForJournal(changes),
        },
      },
      client as unknown as Parameters<typeof appendJournalEntry>[1],
    );
    const journalSeq = await seqOfEntry(client, entry.entryHash, 'смена плеча портфеля');

    const failed = await deliverToTerminal(sync, changes, {
      reason,
      operatorLogin: input.operatorLogin ?? input.operatorId,
      journalSeq,
    });
    if (failed) {
      await client.query('ROLLBACK');
      return failed;
    }

    await client.query('COMMIT');
    return { ok: true, journalSeq };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export interface ClassOverrideInput {
  operatorId: string;
  portfolioKey: string;
  instrumentClass: string;
  leverage: number | null;
  reason: string;
  operatorLogin?: string;
}

export async function setClassOverride(
  input: ClassOverrideInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
  sync: LeverageTerminalSync = terminalLeverageSync(),
): Promise<PortfolioMutationResult> {
  const reason = input.reason?.trim() ?? '';
  if (reason.length === 0) return { ok: false, reason: 'missingReason' };
  const instrumentClass = input.instrumentClass.trim();
  if (!isLeverageClass(instrumentClass)) return { ok: false, reason: 'invalidClass' };
  if (input.leverage !== null && badLeverage(input.leverage)) {
    return { ok: false, reason: 'invalidLeverage' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const portfolio = await client.query(`SELECT 1 FROM leverage_portfolios WHERE key = $1`, [
      input.portfolioKey,
    ]);
    if (portfolio.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'noPortfolio' };
    }

    const cur = await client.query(
      `SELECT leverage FROM leverage_portfolio_class_overrides
        WHERE portfolio_key = $1 AND instrument_class = $2 FOR UPDATE`,
      [input.portfolioKey, instrumentClass],
    );
    const previous =
      cur.rows.length > 0 ? Number((cur.rows[0] as { leverage: number | string }).leverage) : null;

    if (previous === input.leverage) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'alreadyInState' };
    }

    const q = client as unknown as Queryable;
    const users = await sync.usersOfPortfolio(q, input.portfolioKey);
    const before = await sync.read(q, users);

    if (input.leverage === null) {
      await client.query(
        `DELETE FROM leverage_portfolio_class_overrides
          WHERE portfolio_key = $1 AND instrument_class = $2`,
        [input.portfolioKey, instrumentClass],
      );
    } else {
      await client.query(
        `INSERT INTO leverage_portfolio_class_overrides (portfolio_key, instrument_class, leverage)
              VALUES ($1, $2, $3)
         ON CONFLICT (portfolio_key, instrument_class) DO UPDATE SET leverage = EXCLUDED.leverage`,
        [input.portfolioKey, instrumentClass, input.leverage],
      );
    }
    const changes = leverageChanges(before, await sync.read(q, users));

    const entry = await appendJournalEntry(
      {
        operatorId: input.operatorId,
        action: input.leverage === null ? 'leverage.class_override_cleared' : 'leverage.class_override_set',
        subjectKind: 'leverage_portfolio',
        subjectId: input.portfolioKey,
        payload: {
          basis: reason,
          instrumentClass,
          previousLeverage: previous,
          newLeverage: input.leverage,
          terminalLeverage: changesForJournal(changes),
        },
      },
      client as unknown as Parameters<typeof appendJournalEntry>[1],
    );
    const journalSeq = await seqOfEntry(client, entry.entryHash, 'планка класса портфеля');

    const failed = await deliverToTerminal(sync, changes, {
      reason,
      operatorLogin: input.operatorLogin ?? input.operatorId,
      journalSeq,
    });
    if (failed) {
      await client.query('ROLLBACK');
      return failed;
    }

    await client.query('COMMIT');
    return { ok: true, journalSeq };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export interface ClassTableInput {
  operatorId: string;
  portfolioKey: string;
  table: Readonly<Record<string, number | null>>;
  reason: string;
  operatorLogin?: string;
}

export async function setClassLeverageTable(
  input: ClassTableInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
  sync: LeverageTerminalSync = terminalLeverageSync(),
): Promise<PortfolioMutationResult> {
  const reason = input.reason?.trim() ?? '';
  if (reason.length === 0) return { ok: false, reason: 'missingReason' };
  for (const [cls, lev] of Object.entries(input.table)) {
    if (!isLeverageClass(cls)) return { ok: false, reason: 'invalidClass' };
    if (lev !== null && badLeverage(lev)) return { ok: false, reason: 'invalidLeverage' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const portfolio = await client.query(`SELECT 1 FROM leverage_portfolios WHERE key = $1 FOR UPDATE`, [
      input.portfolioKey,
    ]);
    if (portfolio.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'noPortfolio' };
    }

    const cur = await client.query(
      `SELECT instrument_class, leverage FROM leverage_portfolio_class_overrides WHERE portfolio_key = $1`,
      [input.portfolioKey],
    );
    const previous: Record<string, number> = {};
    for (const r of cur.rows as { instrument_class: string; leverage: number | string }[]) {
      if (isLeverageClass(r.instrument_class)) previous[r.instrument_class] = Number(r.leverage);
    }
    const next: Record<string, number> = { ...previous };
    for (const cls of LEVERAGE_CLASSES) {
      if (!Object.prototype.hasOwnProperty.call(input.table, cls)) continue;
      const lev = input.table[cls] ?? null;
      if (lev === null) delete next[cls];
      else next[cls] = lev;
    }
    const touched = LEVERAGE_CLASSES.filter((c) => previous[c] !== next[c]);
    if (touched.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'alreadyInState' };
    }

    const q = client as unknown as Queryable;
    const users = await sync.usersOfPortfolio(q, input.portfolioKey);
    const before = await sync.read(q, users);
    for (const cls of touched) {
      if (next[cls] === undefined) {
        await client.query(
          `DELETE FROM leverage_portfolio_class_overrides WHERE portfolio_key = $1 AND instrument_class = $2`,
          [input.portfolioKey, cls],
        );
      } else {
        await client.query(
          `INSERT INTO leverage_portfolio_class_overrides (portfolio_key, instrument_class, leverage)
                VALUES ($1, $2, $3)
           ON CONFLICT (portfolio_key, instrument_class) DO UPDATE SET leverage = EXCLUDED.leverage`,
          [input.portfolioKey, cls, next[cls]],
        );
      }
    }
    const changes = leverageChanges(before, await sync.read(q, users));

    const entry = await appendJournalEntry(
      {
        operatorId: input.operatorId,
        action: 'leverage.class_table_changed',
        subjectKind: 'leverage_portfolio',
        subjectId: input.portfolioKey,
        payload: { basis: reason, previous, next, terminalLeverage: changesForJournal(changes) },
      },
      client as unknown as Parameters<typeof appendJournalEntry>[1],
    );
    const journalSeq = await seqOfEntry(client, entry.entryHash, 'плечо портфеля по категориям');

    const failed = await deliverToTerminal(sync, changes, {
      reason,
      operatorLogin: input.operatorLogin ?? input.operatorId,
      journalSeq,
    });
    if (failed) {
      await client.query('ROLLBACK');
      return failed;
    }

    await client.query('COMMIT');
    return { ok: true, journalSeq };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export interface SetMinBalanceInput {
  operatorId: string;
  portfolioKey: string;
  /** Порог в центах USDT (минорные единицы). */
  minBalanceMinor: number;
  reason: string;
}

export type MinBalanceResult =
  | { ok: true; journalSeq: number }
  | { ok: false; reason: 'missingReason' }
  | { ok: false; reason: 'invalidAmount' }
  | { ok: false; reason: 'noPortfolio' }
  | { ok: false; reason: 'alreadyInState' }
  | { ok: false; reason: 'defaultNotZero' }
  | { ok: false; reason: 'notMonotonic'; lower: string; higher: string };

/**
 * Порог баланса для автоматического перехода на портфель. Только admin (проверка в action).
 * Плечо счетов не меняется — терминал не трогаем; меняется только правило перехода.
 */
export async function setPortfolioMinBalance(
  input: SetMinBalanceInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<MinBalanceResult> {
  const reason = input.reason?.trim() ?? '';
  if (reason.length === 0) return { ok: false, reason: 'missingReason' };
  if (!Number.isSafeInteger(input.minBalanceMinor) || input.minBalanceMinor < 0) {
    return { ok: false, reason: 'invalidAmount' };
  }
  const { validateThresholds } = await import('./tier');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const all = await client.query(
      `SELECT key, title, min_balance_minor, sort_order, is_default, is_public
         FROM leverage_portfolios ORDER BY key FOR UPDATE`,
    );
    const rows = (all.rows as Record<string, unknown>[]).map((r) => ({
      key: String(r.key),
      title: String(r.title ?? r.key),
      minBalanceMinor: Number(r.min_balance_minor ?? 0),
      sortOrder: Number(r.sort_order ?? 0),
      isDefault: Boolean(r.is_default),
      isPublic: Boolean(r.is_public),
    }));
    const target = rows.find((r) => r.key === input.portfolioKey);
    if (!target) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'noPortfolio' };
    }
    if (target.minBalanceMinor === input.minBalanceMinor) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'alreadyInState' };
    }
    const next = rows.map((r) => (r.key === target.key ? { ...r, minBalanceMinor: input.minBalanceMinor } : r));
    const verdict = validateThresholds(next);
    if (!verdict.ok) {
      await client.query('ROLLBACK');
      return verdict.reason === 'defaultNotZero'
        ? { ok: false, reason: 'defaultNotZero' }
        : { ok: false, reason: 'notMonotonic', lower: verdict.lower, higher: verdict.higher };
    }
    await client.query(
      `UPDATE leverage_portfolios SET min_balance_minor = $2, updated_at = now() WHERE key = $1`,
      [target.key, input.minBalanceMinor],
    );
    const entry = await appendJournalEntry(
      {
        operatorId: input.operatorId,
        action: 'leverage.portfolio_min_balance_set',
        subjectKind: 'leverage_portfolio',
        subjectId: target.key,
        payload: { basis: reason, previousMinBalanceMinor: target.minBalanceMinor, newMinBalanceMinor: input.minBalanceMinor },
      },
      client as unknown as Parameters<typeof appendJournalEntry>[1],
    );
    const journalSeq = await seqOfEntry(client, entry.entryHash, 'порог баланса портфеля');
    await client.query('COMMIT');
    return { ok: true, journalSeq };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
