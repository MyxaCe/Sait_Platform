import {
  appendJournalSeqWithinTx,
  inTransaction,
  readPlatformMoneySettings,
  rollback,
  type PlatformMoneySettings,
  type PoolLike,
} from '@broker/money';
import { moneyPool } from './runtime';

/**
 * «Настройки платформы» — денежные (дизайн §3): KYC-гейты ввода/вывода и
 * минимумы. Строка-синглтон `platform_money_settings`. Изменение — только с
 * основанием, журнал `platform.money_settings.updated` (до/после) той же
 * транзакцией. Пустое изменение не пишется.
 */

export type SettingsResult =
  | { ok: true; journalSeq: number }
  | { ok: false; reason: 'missingReason' | 'invalidMinimum' | 'noChange' };

/** Предел минимума — 1 млн USDT (защита от опечатки «лишние нули»). */
const MAX_MIN = 100_000_000;

export async function updatePlatformMoneySettings(
  input: { operatorId: string; reason: string; next: PlatformMoneySettings },
  pool: PoolLike = moneyPool(),
): Promise<SettingsResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, reason: 'missingReason' };
  for (const v of [input.next.minDepositMinor, input.next.minWithdrawMinor]) {
    if (!Number.isSafeInteger(v) || v < 0 || v > MAX_MIN) return { ok: false, reason: 'invalidMinimum' };
  }

  return inTransaction<SettingsResult>(pool, async (tx) => {
    await tx.query(`INSERT INTO platform_money_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    await tx.query(`SELECT id FROM platform_money_settings WHERE id = 1 FOR UPDATE`);
    const before = await readPlatformMoneySettings(tx);
    const changed = (Object.keys(input.next) as (keyof PlatformMoneySettings)[]).filter(
      (k) => before[k] !== input.next[k],
    );
    if (changed.length === 0) return rollback<SettingsResult>({ ok: false, reason: 'noChange' });

    await tx.query(
      `UPDATE platform_money_settings
          SET deposit_requires_kyc = $1, withdraw_requires_kyc = $2,
              min_deposit_minor = $3, min_withdraw_minor = $4,
              updated_at = now(), updated_by = $5
        WHERE id = 1`,
      [
        input.next.depositRequiresKyc,
        input.next.withdrawRequiresKyc,
        input.next.minDepositMinor,
        input.next.minWithdrawMinor,
        input.operatorId,
      ],
    );
    const seq = await appendJournalSeqWithinTx(
      {
        operatorId: input.operatorId,
        action: 'platform.money_settings.updated',
        subjectKind: 'platform',
        subjectId: 'money_settings',
        payload: { basis: reason, changed, before, after: input.next },
      },
      tx,
    );
    await tx.query(`UPDATE platform_money_settings SET last_journal_seq = $1 WHERE id = 1`, [seq]);
    return { ok: true, journalSeq: seq };
  });
}

export async function getPlatformMoneySettings(): Promise<PlatformMoneySettings> {
  return readPlatformMoneySettings(moneyPool());
}
