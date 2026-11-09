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

/**
 * Плечо КЛИЕНТА (Р-446, Р-049): портфель как атрибут клиента (WEB-44) и
 * override клиента по заявке (WEB-46, приоритет над портфелем и классом).
 *
 * Образец — `lib/clients/block.ts`. Одно решение = одна транзакция: смена
 * `client_leverage` И запись в неизменяемый журнал (кто/когда/основание/№
 * заявки), привязка `last_journal_seq`. Либо оба, либо ни одного.
 *
 * `operatorId` — из СЕССИИ (Р-451), роль-гейт — на стороне action-а.
 * Строка `client_leverage` заводится первым решением; портфель обязателен
 * (NOT NULL), поэтому без явного портфеля клиент садится в портфель по
 * умолчанию (его ключ ищем в той же транзакции).
 *
 * **Плечо доезжает до терминала** (`terminal-sync.ts`): если решение меняет
 * ДЕЙСТВУЮЩЕЕ плечо клиента, в той же транзакции зовётся терминал; отказ →
 * откат всего (fail-closed), оператор видит `terminalUnavailable` /
 * `terminalRefused`.
 */

/** Плечо — целое 1..1000: верхняя граница терминала (`broker::MAX_LEVERAGE`). */
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
  /** Логин оператора — в журнал терминала (`operator`). Нет — `operatorId`. */
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

/**
 * Назначить клиенту портфель (WEB-44 — портфель как атрибут клиента). Это
 * смена ГЛОБАЛЬНОЙ для клиента планки (его базового плеча); override клиента,
 * если выдан, остаётся в приоритете и не трогается. Журналируется
 * `leverage.client_portfolio_set` с diff.
 */
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
      // Терминал не принял — не меняется ничего: ни портфель, ни журнал.
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
  /** Знаменатель 1:N, выдаваемый клиенту по заявке. */
  leverage: number;
  /** Основание (обязательно). */
  reason: string;
  /** № заявки (обязательно) — override выдаётся ТОЛЬКО по заявке (Р-446). */
  ticket: string;
  operatorLogin?: string;
}

/**
 * Выдать клиенту override плеча ПО ЗАЯВКЕ (WEB-46). Приоритет над портфелем и
 * планкой класса (Р-446). Запись в журнал — прямое требование: кто/когда/
 * основание/№ заявки (`leverage.override_set`), «не тихо в базе».
 *
 * Если у клиента ещё нет строки `client_leverage`, он садится в портфель по
 * умолчанию (портфель обязателен), а сверху получает override.
 */
export async function setClientOverride(
  input: SetClientOverrideInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
  sync: LeverageTerminalSync = terminalLeverageSync(),
): Promise<ClientLeverageResult> {
  const reason = input.reason?.trim() ?? '';
  const ticket = input.ticket?.trim() ?? '';
  // Основание И заявка обязательны: override «не тихо в базе» (Р-446).
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
        // Нет портфеля по умолчанию — посадить клиента некуда, fail-closed.
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
      // Терминал не принял — не меняется ничего: ни override, ни журнал.
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

/**
 * Снять override клиента — вернуть к портфелю (WEB-46, §3.8). Journaled
 * `leverage.override_cleared`. Нечего снимать (override не выдан) → `noOverride`,
 * ничего не пишем.
 */
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
      // Снимать нечего — override не выдан. Не шумим в журнал.
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
      // Терминал не принял — не меняется ничего: ни override, ни журнал.
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
