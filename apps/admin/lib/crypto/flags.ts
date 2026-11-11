import {
  activeWithdrawBanSql,
  appendJournalSeqWithinTx,
  inTransaction,
  rollback,
  type ClientMoneyFlags,
  type KycSetting,
  type PoolLike,
  type TerminalMoneyClient,
} from '@broker/money';
import { moneyPool, terminalMoney } from './runtime';

/**
 * Денежные флаги клиента (дизайн §3): KYC-гейты ввода/вывода (наследовать/
 * да/нет), «Заморозка счёта», «Запрет вывода». Форма-с-основанием; каждое
 * изменённое поле — своя запись журнала, все одной транзакцией.
 *
 * **Заморозка — сначала терминал** (`trading-freeze` реального счёта), потом
 * флаг в базе, и всё внутри одной транзакции с запертой строкой. Терминал
 * отказал или не ответил → флаг НЕ ставится (fail-closed), оператор видит
 * понятную ошибку. Если COMMIT упал после успешного вызова — повтор той же
 * формы снова вызовет `trading-freeze` с тем же значением (операция по смыслу
 * идемпотентна: «заморожен = true»).
 */

export type FlagsResult =
  | { ok: true; changed: string[] }
  | { ok: false; reason: 'missingReason' | 'noClient' | 'noChange' | 'terminalUnavailable' }
  | { ok: false; reason: 'terminalRefused'; code: string };

const ACTION: Record<keyof ClientMoneyFlags, (v: unknown) => string> = {
  depositKyc: () => 'client.money.deposit_kyc_changed',
  withdrawKyc: () => 'client.money.withdraw_kyc_changed',
  frozen: (v) => (v ? 'client.money.frozen' : 'client.money.unfrozen'),
  withdrawBanned: (v) => (v ? 'client.money.withdraw_banned' : 'client.money.withdraw_unbanned'),
};

function asKyc(v: unknown): KycSetting {
  return v === 'required' || v === 'not_required' ? v : 'inherit';
}

export async function setClientMoneyFlags(
  input: {
    operatorId: string;
    operatorLogin: string;
    userId: string;
    reason: string;
    next: ClientMoneyFlags;
  },
  pool: PoolLike = moneyPool(),
  terminal: TerminalMoneyClient = terminalMoney(),
): Promise<FlagsResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'missingReason' };

  return inTransaction<FlagsResult>(pool, async (tx) => {
    const user = await tx.query(`SELECT 1 FROM users WHERE id = $1`, [input.userId]);
    if (user.rows.length === 0) return rollback<FlagsResult>({ ok: false, reason: 'noClient' });

    await tx.query(
      `INSERT INTO client_money_flags (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [input.userId],
    );
    const cur = await tx.query(
      // Запрет вывода — ДЕЙСТВУЮЩИЙ (истёкший срок не считается запретом):
      // форма показывает и сравнивает то же, что видит политика денег.
      `SELECT deposit_kyc, withdraw_kyc, frozen, ${activeWithdrawBanSql('f')} AS withdraw_banned
         FROM client_money_flags f WHERE user_id = $1 FOR UPDATE`,
      [input.userId],
    );
    const r = cur.rows[0]!;
    const before: ClientMoneyFlags = {
      depositKyc: asKyc(r.deposit_kyc),
      withdrawKyc: asKyc(r.withdraw_kyc),
      frozen: Boolean(r.frozen),
      withdrawBanned: Boolean(r.withdraw_banned),
    };
    const changed = (Object.keys(input.next) as (keyof ClientMoneyFlags)[]).filter(
      (k) => before[k] !== input.next[k],
    );
    if (changed.length === 0) return rollback<FlagsResult>({ ok: false, reason: 'noChange' });

    if (changed.includes('frozen')) {
      const out = await terminal.tradingFreeze(
        input.userId,
        { frozen: input.next.frozen, reason, operator: input.operatorLogin },
        'real',
      );
      if (out.state === 'refused') {
        return rollback<FlagsResult>({ ok: false, reason: 'terminalRefused', code: out.code });
      }
      if (out.state === 'unavailable') {
        return rollback<FlagsResult>({ ok: false, reason: 'terminalUnavailable' });
      }
    }

    await tx.query(
      `UPDATE client_money_flags
          SET deposit_kyc = $2, withdraw_kyc = $3, frozen = $4, withdraw_banned = $5,
              -- Запрет из денежных флагов — бессрочный; смена флага сбрасывает срок
              -- и происхождение (заморозку «учётных данных» финансы снимают здесь же).
              withdraw_ban_until = CASE WHEN $7::boolean THEN NULL ELSE withdraw_ban_until END,
              withdraw_ban_kind = CASE WHEN $7::boolean THEN (CASE WHEN $5::boolean THEN 'money_flags' ELSE NULL END) ELSE withdraw_ban_kind END,
              withdraw_ban_reason = CASE WHEN $7::boolean THEN (CASE WHEN $5::boolean THEN $8 ELSE NULL END) ELSE withdraw_ban_reason END,
              updated_at = now(), updated_by = $6
        WHERE user_id = $1`,
      [
        input.userId,
        input.next.depositKyc,
        input.next.withdrawKyc,
        input.next.frozen,
        input.next.withdrawBanned,
        input.operatorId,
        changed.includes('withdrawBanned'),
        reason,
      ],
    );

    let lastSeq = 0;
    for (const key of changed) {
      lastSeq = await appendJournalSeqWithinTx(
        {
          operatorId: input.operatorId,
          action: ACTION[key](input.next[key]),
          subjectKind: 'client',
          subjectId: input.userId,
          payload: { basis: reason, field: key, before: before[key], after: input.next[key] },
        },
        tx,
      );
    }
    await tx.query(`UPDATE client_money_flags SET last_journal_seq = $2 WHERE user_id = $1`, [
      input.userId,
      lastSeq,
    ]);
    return { ok: true, changed };
  });
}
