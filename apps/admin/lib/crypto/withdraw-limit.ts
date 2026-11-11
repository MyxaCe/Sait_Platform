import {
  appendJournalSeqWithinTx,
  inTransaction,
  MAX_UNVERIFIED_WITHDRAW_BPS,
  rollback,
  type PoolLike,
} from '@broker/money';
import { moneyPool } from './runtime';

/**
 * Лимит вывода без верификации — переопределение У КЛИЕНТА (ветка
 * demo-withdraw-limits). `bps = null` — наследовать из настроек платформы;
 * 0 — без верификации вывода нет вовсе; иначе доля «баланса до выводов»
 * в б.п. (формула — `@broker/money` `kyc-allowance.ts`).
 *
 * Как соседние денежные флаги: основание обязательно, запись и журнал
 * `client.money.unverified_withdraw_limit_changed` (до/после) — одной
 * транзакцией с запертой строкой флагов. Пустое изменение не пишется.
 */

export type WithdrawLimitResult =
  | { ok: true; journalSeq: number }
  | { ok: false; reason: 'missingReason' | 'noClient' | 'noChange' | 'invalidPercent' };

export async function setClientUnverifiedWithdrawLimit(
  input: { operatorId: string; userId: string; reason: string; bps: number | null },
  pool: PoolLike = moneyPool(),
): Promise<WithdrawLimitResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'missingReason' };
  const bps = input.bps;
  if (bps !== null && (!Number.isInteger(bps) || bps < 0 || bps > MAX_UNVERIFIED_WITHDRAW_BPS)) {
    return { ok: false, reason: 'invalidPercent' };
  }

  return inTransaction<WithdrawLimitResult>(pool, async (tx) => {
    const user = await tx.query(`SELECT 1 FROM users WHERE id = $1`, [input.userId]);
    if (user.rows.length === 0) return rollback<WithdrawLimitResult>({ ok: false, reason: 'noClient' });

    await tx.query(
      `INSERT INTO client_money_flags (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [input.userId],
    );
    const cur = await tx.query(
      `SELECT unverified_withdraw_bps FROM client_money_flags WHERE user_id = $1 FOR UPDATE`,
      [input.userId],
    );
    const raw = cur.rows[0]?.unverified_withdraw_bps;
    const before = raw === null || raw === undefined ? null : Number(raw);
    if (before === bps) return rollback<WithdrawLimitResult>({ ok: false, reason: 'noChange' });

    await tx.query(
      `UPDATE client_money_flags
          SET unverified_withdraw_bps = $2, updated_at = now(), updated_by = $3
        WHERE user_id = $1`,
      [input.userId, bps, input.operatorId],
    );
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: input.operatorId,
        action: 'client.money.unverified_withdraw_limit_changed',
        subjectKind: 'client',
        subjectId: input.userId,
        // null — «наследовать из платформы».
        payload: { basis: reason, field: 'unverifiedWithdrawBps', before, after: bps },
      },
      tx,
    );
    await tx.query(`UPDATE client_money_flags SET last_journal_seq = $2 WHERE user_id = $1`, [input.userId, seq]);
    return { ok: true, journalSeq: seq };
  });
}

/**
 * Процент из формы → б.п. «5» → 500, «2,5» → 250, «0» → 0; до двух знаков
 * после запятой, 0..100. Мусор → `null` (форма покажет ошибку).
 */
export function percentToBps(raw: string): number | null {
  const v = raw.trim().replace(',', '.').replace(/\s*%$/, '');
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(v)) return null;
  const [int, frac = ''] = v.split('.');
  const bps = Number(int) * 100 + Number(frac.padEnd(2, '0'));
  return bps <= MAX_UNVERIFIED_WITHDRAW_BPS ? bps : null;
}

/** б.п. → «5 %», «2,5 %». */
export function formatBpsPercent(bps: number): string {
  const s = (bps / 100).toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
  return `${s} %`;
}
