import {
  appendJournalSeqWithinTx,
  inTransaction,
  MAX_UNVERIFIED_WITHDRAW_BPS,
  readPlatformMoneySettings,
  rollback,
  type PlatformMoneySettings,
  type PoolLike,
} from '@broker/money';
import { moneyPool } from './runtime';

export type SettingsResult =
  | { ok: true; journalSeq: number }
  | { ok: false; reason: 'missingReason' | 'invalidMinimum' | 'invalidPercent' | 'noChange' };

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
  const bps = input.next.unverifiedWithdrawBps;
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_UNVERIFIED_WITHDRAW_BPS) {
    return { ok: false, reason: 'invalidPercent' };
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
              unverified_withdraw_bps = $6,
              updated_at = now(), updated_by = $5
        WHERE id = 1`,
      [
        input.next.depositRequiresKyc,
        input.next.withdrawRequiresKyc,
        input.next.minDepositMinor,
        input.next.minWithdrawMinor,
        input.operatorId,
        input.next.unverifiedWithdrawBps,
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
