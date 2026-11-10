import {
  centsToUsdtRaw,
  creditClaimedDeposit,
  ensureWithdrawalDebited,
  flagWithdrawalForReview,
  noteDepositCheck,
  noteWithdrawalCheck,
  readPlatformMoneySettings,
  recordUnidentified,
  rejectClaimedDeposit,
  settleWithdrawal,
  type PoolLike,
  type TerminalMoneyClient,
} from '@broker/money';
import { ChainUnavailableError, type ChainReader } from './trongrid';
import { verifyDeposit, verifyPayout } from './verify';
import { describeError, formatError, secretsFromEnv, type ErrorInfo } from './errors';

/**
 * Один проход наблюдателя (опрос раз в 15 с). Ключей нет — только чтение
 * сети и вызовы internal-маршрутов терминала через `@broker/money`.
 *
 *  (а) заявленные хэши депозитов → зачисление / отклонение / ждём;
 *  (б) входящие USDT без заявки старше 10 мин → «неопознанные»;
 *  (в) хэши выплат → settled / needs_review (без авто-возврата);
 *  (г) списания выводов с неизвестным исходом → довести повтором (тот же ref).
 *
 * Ошибка одной заявки (сеть, терминал) не останавливает проход: она
 * записывается заметкой и повторяется на следующем тике. Сбой сети НИКОГДА
 * не превращается в отклонение.
 */

export interface WatcherDeps {
  pool: PoolLike;
  chain: ChainReader;
  terminal: TerminalMoneyClient;
  exchangeAddress: string;
  now?: () => number;
  log?: (msg: string) => void;
  /** Ошибки прохода — с причиной (по умолчанию console.error). */
  logError?: (msg: string, detail: TickError) => void;
  /** Значения, которые нельзя печатать (по умолчанию — секреты из env). */
  secrets?: readonly string[];
}

/** Причина одной ошибки прохода: этап, заявка, тип и сообщение (без секретов). */
export interface TickError extends ErrorInfo {
  stage: 'deposit' | 'scan' | 'payout' | 'debit';
  /** id заявки (депозит/вывод), если ошибка про заявку. */
  id?: string;
  /** Хэш транзакции заявки, если есть. */
  txHash?: string;
}

export const UNIDENTIFIED_AFTER_MS = 10 * 60_000;
export const CLAIM_NOT_FOUND_AFTER_MS = 30 * 60_000;
export const PAYOUT_NOT_FOUND_AFTER_MS = 24 * 3600_000;
const SCAN_WINDOW_MS = 24 * 3600_000;
const PENDING_DEBIT_AFTER_MS = 60_000;

export interface TickStats {
  credited: number;
  rejected: number;
  waiting: number;
  unidentified: number;
  settled: number;
  review: number;
  debits: number;
  errors: number;
}

function age(now: number, at: unknown): number {
  return now - new Date(at as string | Date).getTime();
}

export async function runTick(deps: WatcherDeps): Promise<TickStats> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((m: string) => console.info(`[chain-watcher] ${m}`));
  const s: TickStats = { credited: 0, rejected: 0, waiting: 0, unidentified: 0, settled: 0, review: 0, debits: 0, errors: 0 };
  const secrets = deps.secrets ?? secretsFromEnv();
  const logError =
    deps.logError ?? ((m: string, d: TickError) => console.error(`[chain-watcher] ${m}`, JSON.stringify(d)));
  /** Счётчик + строка с причиной: «errors:1» без причины больше не бывает. */
  const fail = (where: Omit<TickError, keyof ErrorInfo>, e: unknown, info = describeError(e, secrets)): ErrorInfo => {
    s.errors++;
    const detail: TickError = { ...where, ...info };
    const ref = [where.id ? `заявка ${where.id}` : null, where.txHash ? `хэш ${where.txHash}` : null].filter(Boolean).join(', ');
    logError(`ошибка (${where.stage}${ref ? `; ${ref}` : ''}): ${formatError(info)}`, detail);
    return info;
  };
  const settings = await readPlatformMoneySettings(deps.pool);

  // (а) заявленные депозиты
  const claimed = await deps.pool.query(
    `SELECT id, tx_hash, claimed_at FROM crypto_deposits WHERE status = 'claimed' ORDER BY claimed_at LIMIT 50`,
  );
  for (const row of claimed.rows) {
    const id = row.id as string;
    const hash = row.tx_hash as string;
    try {
      const tx = await deps.chain.getSolidTx(hash);
      if (!tx) {
        const exists = await deps.chain.txExists(hash);
        if (!exists && age(now(), row.claimed_at) > CLAIM_NOT_FOUND_AFTER_MS) {
          await rejectClaimedDeposit(deps.pool, { depositId: id, reason: 'not_found' });
          s.rejected++;
          log(`депозит ${hash}: нет в сети дольше 30 мин — отклонён`);
        } else {
          await noteDepositCheck(deps.pool, id, exists ? 'ждём необратимости блока' : 'транзакция пока не видна в сети');
          s.waiting++;
        }
        continue;
      }
      const v = verifyDeposit(tx, deps.exchangeAddress);
      if (v.kind === 'rejected') {
        await rejectClaimedDeposit(deps.pool, {
          depositId: id,
          reason: v.reason,
          toAddress: v.toAddress ?? null,
          fromAddress: v.fromAddress ?? null,
          amountRaw: v.amountRaw ?? null,
        });
        s.rejected++;
        log(`депозит ${hash}: отклонён (${v.reason})`);
        continue;
      }
      const r = await creditClaimedDeposit(deps.pool, deps.terminal, {
        depositId: id,
        transfer: { amountRaw: v.amountRaw, fromAddress: v.fromAddress, toAddress: v.toAddress, blockTime: v.blockTime },
        minDepositMinor: settings.minDepositMinor,
      });
      if (r.state === 'credited') {
        s.credited++;
        log(`депозит ${hash}: зачислено ${r.amountMinor} центов (остаток ${r.dustRaw} сырых)`);
      } else if (r.state === 'rejected') {
        s.rejected++;
        log(`депозит ${hash}: отклонён (${r.reason})`);
      } else if (r.state === 'terminal-unavailable') {
        await noteDepositCheck(deps.pool, id, 'сеть подтвердила, терминал не ответил — повторим');
        s.waiting++;
      } else if (r.state === 'terminal-refused') {
        fail({ stage: 'deposit', id, txHash: hash }, null, {
          type: 'TerminalRefused',
          message: 'терминал отказал в зачислении',
          code: String(r.code),
        });
      }
    } catch (e) {
      const info = fail({ stage: 'deposit', id, txHash: hash }, e);
      const msg = e instanceof ChainUnavailableError ? info.message : `ошибка: ${formatError(info)}`;
      await noteDepositCheck(deps.pool, id, msg).catch(() => {});
    }
  }

  // (б) неопознанные: подтверждённые входящие без заявки старше 10 мин
  try {
    const incoming = await deps.chain.listIncomingUsdt(deps.exchangeAddress, now() - SCAN_WINDOW_MS);
    for (const t of incoming) {
      if (now() - t.blockTime.getTime() < UNIDENTIFIED_AFTER_MS) continue;
      if (await recordUnidentified(deps.pool, t)) {
        s.unidentified++;
        log(`неопознанное поступление ${t.txHash} от ${t.fromAddress}`);
      }
    }
  } catch (e) {
    fail({ stage: 'scan' }, e);
  }

  // (в) выплаты с внесённым хэшем
  const sent = await deps.pool.query(
    `SELECT id, payout_tx_hash, to_address, amount_minor, sent_at FROM crypto_withdrawals
      WHERE status = 'sent' ORDER BY sent_at LIMIT 50`,
  );
  for (const row of sent.rows) {
    const id = row.id as string;
    const hash = row.payout_tx_hash as string;
    try {
      const tx = await deps.chain.getSolidTx(hash);
      if (!tx) {
        const exists = await deps.chain.txExists(hash);
        if (!exists && age(now(), row.sent_at) > PAYOUT_NOT_FOUND_AFTER_MS) {
          await flagWithdrawalForReview(deps.pool, { withdrawalId: id, reason: 'транзакция не найдена в сети за 24 ч' });
          s.review++;
        } else {
          await noteWithdrawalCheck(deps.pool, id, exists ? 'ждём необратимости блока' : 'транзакция пока не видна в сети');
        }
        continue;
      }
      const v = verifyPayout(tx, {
        toAddress: row.to_address as string,
        amountRaw: centsToUsdtRaw(Number(row.amount_minor)),
      });
      if (v.kind === 'ok') {
        await settleWithdrawal(deps.pool, { withdrawalId: id, fromAddress: v.fromAddress });
        s.settled++;
        log(`выплата ${hash}: сошлась — исполнено`);
      } else {
        await flagWithdrawalForReview(deps.pool, { withdrawalId: id, reason: v.reason });
        s.review++;
        log(`выплата ${hash}: не сошлось — на проверку (${v.reason})`);
      }
    } catch (e) {
      const info = fail({ stage: 'payout', id, txHash: hash }, e);
      await noteWithdrawalCheck(deps.pool, id, formatError(info)).catch(() => {});
    }
  }

  // (г) списания с неизвестным исходом
  const pending = await deps.pool.query(
    `SELECT id, requested_at FROM crypto_withdrawals
      WHERE status = 'requested' AND debit_state = 'pending' ORDER BY requested_at LIMIT 20`,
  );
  for (const row of pending.rows) {
    if (age(now(), row.requested_at) < PENDING_DEBIT_AFTER_MS) continue;
    try {
      const r = await ensureWithdrawalDebited(deps.pool, deps.terminal, row.id as string);
      if (r.state !== 'pending') s.debits++;
    } catch (e) {
      fail({ stage: 'debit', id: String(row.id) }, e);
    }
  }

  return s;
}
