import type { PoolClient } from 'pg';
import { getPool } from '../db';
import { appendJournalEntry } from '../journal/journal';

/**
 * Изменения ПОРТФЕЛЯ плеча — глобально для всех его клиентов (WEB-47, §3.9) и
 * планка класса внутри портфеля (WEB-45, §3.9). Р-446, Р-049.
 *
 * Образец — `lib/clients/block.ts`: одно решение = одна транзакция, и в ней ДВА
 * неразделимых факта: смена строки портфеля И запись в неизменяемый журнал
 * (кто/когда/основание/что изменилось). Либо оба, либо ни одного (BEGIN/COMMIT).
 *
 * Основание ОБЯЗАТЕЛЬНО: смена плеча портфеля — массовое действие (Р-394
 * требует основание у любого значимого; §3.9 — danger-подтверждение). Пустой
 * переход (новое плечо равно текущему) — `alreadyInState`, ничего не пишем.
 *
 * `operatorId` — из СЕССИИ вызывающим server action-ом, НЕ из формы (Р-451).
 * Роль-гейт (admin only для §3.9) — на стороне action-а; этот модуль —
 * транзакционное ядро, личность и право проверены до входа.
 */

export interface ChangePortfolioInput {
  /** `operators.id` автора — из серверной сессии, НЕ из формы. */
  operatorId: string;
  portfolioKey: string;
  /** Новый знаменатель 1:N базового плеча портфеля. */
  baseLeverage: number;
  reason: string;
}

export type PortfolioMutationResult =
  | { ok: true; journalSeq: number }
  | { ok: false; reason: 'missingReason' }
  | { ok: false; reason: 'invalidLeverage' }
  | { ok: false; reason: 'noPortfolio' }
  | { ok: false; reason: 'alreadyInState' };

function badLeverage(value: number): boolean {
  return !Number.isInteger(value) || value < 1;
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

/**
 * Сменить базовое плечо портфеля ГЛОБАЛЬНО (WEB-47). Действует на всех клиентов
 * портфеля, у кого нет override клиента или планки класса по инструменту.
 * Открытые позиции НЕ трогаются: они держат снимок плеча на момент открытия
 * (Р-446, сторона терминала) — смена портфеля задним числом защиту не снимает.
 */
export async function changePortfolioLeverage(
  input: ChangePortfolioInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
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

    await client.query(
      `UPDATE leverage_portfolios SET base_leverage = $2, updated_at = now() WHERE key = $1`,
      [input.portfolioKey, input.baseLeverage],
    );

    const entry = await appendJournalEntry(
      {
        operatorId: input.operatorId,
        action: 'leverage.portfolio_changed',
        subjectKind: 'leverage_portfolio',
        subjectId: input.portfolioKey,
        payload: { basis: reason, previousBase, newBase: input.baseLeverage },
      },
      client as unknown as Parameters<typeof appendJournalEntry>[1],
    );
    const journalSeq = await seqOfEntry(client, entry.entryHash, 'смена плеча портфеля');

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
  /** Новая планка класса (знаменатель 1:N) или `null` — снять планку. */
  leverage: number | null;
  reason: string;
}

/**
 * Задать/снять планку класса ВНУТРИ портфеля (WEB-45) — единственное место, где
 * класс ещё нужен (Р-446). `leverage: null` снимает планку (класс возвращается
 * к базе портфеля). Журналируется `leverage.class_override_set` /
 * `leverage.class_override_cleared` с diff.
 */
export async function setClassOverride(
  input: ClassOverrideInput,
  pool: { connect(): Promise<PoolClient> } = getPool(),
): Promise<PortfolioMutationResult> {
  const reason = input.reason?.trim() ?? '';
  if (reason.length === 0) return { ok: false, reason: 'missingReason' };
  const instrumentClass = input.instrumentClass.trim();
  if (instrumentClass.length === 0) return { ok: false, reason: 'invalidLeverage' };
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

    // Содержательный переход обязателен: задать ту же планку / снять
    // несуществующую — пустой переход, не шумим в журнал.
    if (previous === input.leverage) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'alreadyInState' };
    }

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
        },
      },
      client as unknown as Parameters<typeof appendJournalEntry>[1],
    );
    const journalSeq = await seqOfEntry(client, entry.entryHash, 'планка класса портфеля');

    await client.query('COMMIT');
    return { ok: true, journalSeq };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
