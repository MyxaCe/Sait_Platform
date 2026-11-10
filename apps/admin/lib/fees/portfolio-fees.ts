import type { PoolClient } from 'pg';
import {
  clientsOfPortfolio,
  MAX_FEE_BPS,
  pushFeesToTerminal,
  terminalFeesClientFromEnv,
  type Queryable,
  type TerminalFeesClient,
} from '@broker/money';
import { getPool } from '../db';
import { appendJournalEntry } from '../journal/journal';

/**
 * ТАРИФ ПОРТФЕЛЯ — наценка на спред и комиссия (решение владельца №6) плюс
 * публичные условия типа счёта (инструменты, описание — для /accounts).
 *
 * Образец — `lib/leverage/portfolio.ts`: одно решение = одна транзакция,
 * правка портфеля И запись журнала `leverage.portfolio_fees_changed`; затем
 * — доставка ставок в терминал (`POST …/{demo|real}/fees`, контракт —
 * `@broker/money` fees-contract.ts) ВСЕМ клиентам портфеля (для портфеля по
 * умолчанию — и тем, у кого строки нет). Fail-closed: терминал отказал / не
 * ответил → ROLLBACK (ни портфель, ни журнал не меняются), применённое в
 * терминале откатывается к «до». Если ставки не менялись (правили только
 * тексты) — терминал не зовём.
 */

export interface PortfolioFeesInput {
  operatorId: string;
  operatorLogin?: string;
  portfolioKey: string;
  markupBps: number;
  commissionBps: number;
  instruments: string | null;
  description: string | null;
  reason: string;
}

export type PortfolioFeesResult =
  | { ok: true; journalSeq: number; clients: number }
  | { ok: false; reason: 'missingReason' | 'invalidFees' | 'noPortfolio' | 'noChange' | 'terminalUnavailable' }
  | { ok: false; reason: 'terminalRefused'; code: string };

export interface FeesSync {
  usersOfPortfolio(db: Queryable, portfolioKey: string): Promise<string[]>;
  terminal: TerminalFeesClient;
}

export function terminalFeesSync(): FeesSync {
  return { usersOfPortfolio: clientsOfPortfolio, terminal: terminalFeesClientFromEnv() };
}

const badBps = (v: number) => !Number.isInteger(v) || v < 0 || v > MAX_FEE_BPS;
const clean = (v: string | null) => {
  const t = v?.trim() ?? '';
  return t.length > 0 ? t.slice(0, 2000) : null;
};

export async function changePortfolioFees(
  input: PortfolioFeesInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
  sync: FeesSync = terminalFeesSync(),
): Promise<PortfolioFeesResult> {
  const reason = input.reason?.trim() ?? '';
  if (!reason) return { ok: false, reason: 'missingReason' };
  if (badBps(input.markupBps) || badBps(input.commissionBps)) return { ok: false, reason: 'invalidFees' };
  const instruments = clean(input.instruments);
  const description = clean(input.description);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT markup_bps, commission_bps, instruments, description FROM leverage_portfolios WHERE key = $1 FOR UPDATE`,
      [input.portfolioKey],
    );
    const row = cur.rows[0] as
      | { markup_bps: number | string; commission_bps: number | string; instruments: string | null; description: string | null }
      | undefined;
    if (!row) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'noPortfolio' };
    }
    const before = {
      markupBps: Number(row.markup_bps),
      commissionBps: Number(row.commission_bps),
      instruments: row.instruments ?? null,
      description: row.description ?? null,
    };
    const after = { markupBps: input.markupBps, commissionBps: input.commissionBps, instruments, description };
    const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => before[k] !== after[k]);
    if (changed.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'noChange' };
    }
    const feesChanged = before.markupBps !== after.markupBps || before.commissionBps !== after.commissionBps;

    await client.query(
      `UPDATE leverage_portfolios
          SET markup_bps = $2, commission_bps = $3, instruments = $4, description = $5, updated_at = now()
        WHERE key = $1`,
      [input.portfolioKey, after.markupBps, after.commissionBps, instruments, description],
    );
    const users = feesChanged ? await sync.usersOfPortfolio(client as unknown as Queryable, input.portfolioKey) : [];

    const entry = await appendJournalEntry(
      {
        operatorId: input.operatorId,
        action: 'leverage.portfolio_fees_changed',
        subjectKind: 'leverage_portfolio',
        subjectId: input.portfolioKey,
        payload: {
          basis: reason,
          changed,
          before: Object.fromEntries(changed.map((k) => [k, before[k]])),
          after: Object.fromEntries(changed.map((k) => [k, after[k]])),
          terminalClients: users.length,
        },
      },
      client as unknown as Parameters<typeof appendJournalEntry>[1],
    );
    const seqRow = await client.query(`SELECT seq FROM admin_action_journal WHERE entry_hash = $1`, [entry.entryHash]);
    const journalSeq = Number((seqRow.rows[0] as { seq?: number | string } | undefined)?.seq);
    if (!Number.isFinite(journalSeq)) throw new Error('не удалось получить seq записи журнала: тариф портфеля');

    if (feesChanged && users.length > 0) {
      const out = await pushFeesToTerminal(
        sync.terminal,
        users.map((userId) => ({ userId, fees: { markupBps: after.markupBps, commissionBps: after.commissionBps } })),
        { reason, operator: input.operatorLogin ?? input.operatorId, externalRef: `adm-journal:${journalSeq}` },
      );
      if (!out.ok) {
        if (out.compensationFailed > 0) {
          console.error(
            `[fees] откат тарифа в терминале не дошёл (${out.compensationFailed} счетов): терминал впереди сайта до повтора формы или входа клиента`,
          );
        }
        await client.query('ROLLBACK');
        if (out.reason === 'terminalRefused') {
          console.error(`[fees] терминал отказал в смене тарифа: ${out.code}`);
          return { ok: false, reason: 'terminalRefused', code: out.code };
        }
        return { ok: false, reason: 'terminalUnavailable' };
      }
    }

    await client.query('COMMIT');
    return { ok: true, journalSeq, clients: users.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
