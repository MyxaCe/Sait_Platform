import type { Queryable } from './db';

export type KycSetting = 'inherit' | 'required' | 'not_required';
export type PolicySource = 'platform' | 'client';

export type MoneyPolicyReason =
  | 'no_client'
  | 'blocked'
  | 'frozen'
  | 'withdraw_banned'
  | 'kyc_required';

export interface PlatformMoneySettings {
  depositRequiresKyc: boolean;
  withdrawRequiresKyc: boolean;
  minDepositMinor: number;
  minWithdrawMinor: number;
  unverifiedWithdrawBps: number;
}

export const MAX_UNVERIFIED_WITHDRAW_BPS = 10_000;

export const DEFAULT_PLATFORM_SETTINGS: PlatformMoneySettings = {
  depositRequiresKyc: false,
  withdrawRequiresKyc: true,
  minDepositMinor: 1000,
  minWithdrawMinor: 1000,
  unverifiedWithdrawBps: 500,
};

export interface ClientMoneyFlags {
  depositKyc: KycSetting;
  withdrawKyc: KycSetting;
  frozen: boolean;
  withdrawBanned: boolean;
}

export const DEFAULT_CLIENT_FLAGS: ClientMoneyFlags = {
  depositKyc: 'inherit',
  withdrawKyc: 'inherit',
  frozen: false,
  withdrawBanned: false,
};

export type WithdrawBanKind = 'money_flags' | 'credentials_manual' | 'credentials_auto';

export interface MoneyPolicyInputs {
  clientExists: boolean;
  blocked: boolean;
  kycVerified: boolean;
  settings: PlatformMoneySettings;
  flags: ClientMoneyFlags;
  withdrawBanUntil?: string | null;
  withdrawBanKind?: WithdrawBanKind | null;
  unverifiedWithdrawBpsOverride?: number | null;
}

export interface EffectiveKyc {
  required: boolean;
  source: PolicySource;
}

export interface EffectiveBps {
  bps: number;
  source: PolicySource;
}

export interface MoneyPolicy {
  depositAllowed: boolean;
  withdrawAllowed: boolean;
  realTradingAllowed: boolean;
  reasons: MoneyPolicyReason[];
  depositReasons: MoneyPolicyReason[];
  withdrawReasons: MoneyPolicyReason[];
  depositKyc: EffectiveKyc;
  withdrawKyc: EffectiveKyc;
  kycVerified: boolean;
  blocked: boolean;
  frozen: boolean;
  withdrawBanned: boolean;
  withdrawBanUntil: string | null;
  withdrawBanKind: WithdrawBanKind | null;
  minDepositMinor: number;
  minWithdrawMinor: number;
  unverifiedWithdraw: EffectiveBps;
  withdrawKycLimited: boolean;
}

function effectiveKyc(flag: KycSetting, platform: boolean): EffectiveKyc {
  if (flag === 'inherit') return { required: platform, source: 'platform' };
  return { required: flag === 'required', source: 'client' };
}

export function computeMoneyPolicy(input: MoneyPolicyInputs): MoneyPolicy {
  const depositKyc = effectiveKyc(input.flags.depositKyc, input.settings.depositRequiresKyc);
  const withdrawKyc = effectiveKyc(input.flags.withdrawKyc, input.settings.withdrawRequiresKyc);

  const override = input.unverifiedWithdrawBpsOverride;
  const unverifiedWithdraw: EffectiveBps =
    override === null || override === undefined
      ? { bps: input.settings.unverifiedWithdrawBps, source: 'platform' }
      : { bps: override, source: 'client' };
  const kycMissingForWithdraw = input.clientExists && withdrawKyc.required && !input.kycVerified;
  const withdrawKycLimited = kycMissingForWithdraw && unverifiedWithdraw.bps > 0;

  const depositReasons: MoneyPolicyReason[] = [];
  const withdrawReasons: MoneyPolicyReason[] = [];

  if (!input.clientExists) {
    depositReasons.push('no_client');
    withdrawReasons.push('no_client');
  } else {
    if (input.blocked) {
      depositReasons.push('blocked');
      withdrawReasons.push('blocked');
    }
    if (input.flags.frozen) withdrawReasons.push('frozen');
    if (input.flags.withdrawBanned) withdrawReasons.push('withdraw_banned');
    if (depositKyc.required && !input.kycVerified) depositReasons.push('kyc_required');
    if (kycMissingForWithdraw && !withdrawKycLimited) withdrawReasons.push('kyc_required');
  }

  const reasons = [...new Set([...depositReasons, ...withdrawReasons])];

  return {
    depositAllowed: depositReasons.length === 0,
    withdrawAllowed: withdrawReasons.length === 0,
    realTradingAllowed: input.clientExists && !input.blocked && !input.flags.frozen,
    reasons,
    depositReasons,
    withdrawReasons,
    depositKyc,
    withdrawKyc,
    kycVerified: input.kycVerified,
    blocked: input.blocked,
    frozen: input.flags.frozen,
    withdrawBanned: input.flags.withdrawBanned,
    withdrawBanUntil: input.flags.withdrawBanned ? (input.withdrawBanUntil ?? null) : null,
    withdrawBanKind: input.flags.withdrawBanned ? (input.withdrawBanKind ?? 'money_flags') : null,
    minDepositMinor: input.settings.minDepositMinor,
    minWithdrawMinor: input.settings.minWithdrawMinor,
    unverifiedWithdraw,
    withdrawKycLimited: withdrawKycLimited && withdrawReasons.length === 0,
  };
}

function asKyc(v: unknown): KycSetting {
  return v === 'required' || v === 'not_required' ? v : 'inherit';
}

export function activeWithdrawBanSql(alias: string): string {
  return `COALESCE(${alias}.withdraw_banned AND (${alias}.withdraw_ban_until IS NULL OR ${alias}.withdraw_ban_until > now()), false)`;
}

function asBanKind(v: unknown): WithdrawBanKind {
  return v === 'credentials_manual' || v === 'credentials_auto' ? v : 'money_flags';
}

function bpsOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= MAX_UNVERIFIED_WITHDRAW_BPS ? n : fallback;
}

function bpsOverride(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return bpsOr(v, 0);
}

const isoOrNull = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

export async function readPlatformMoneySettings(db: Queryable): Promise<PlatformMoneySettings> {
  const r = await db.query(
    `SELECT deposit_requires_kyc, withdraw_requires_kyc, min_deposit_minor, min_withdraw_minor,
            unverified_withdraw_bps
       FROM platform_money_settings WHERE id = 1`,
  );
  const row = r.rows[0];
  if (!row) return { ...DEFAULT_PLATFORM_SETTINGS };
  return {
    depositRequiresKyc: Boolean(row.deposit_requires_kyc),
    withdrawRequiresKyc: Boolean(row.withdraw_requires_kyc),
    minDepositMinor: Number(row.min_deposit_minor),
    minWithdrawMinor: Number(row.min_withdraw_minor),
    unverifiedWithdrawBps: bpsOr(row.unverified_withdraw_bps, 0),
  };
}

export async function loadMoneyPolicyInputs(
  db: Queryable,
  userId: string,
): Promise<MoneyPolicyInputs> {
  const r = await db.query(
    `SELECT u.id,
            COALESCE(cb.blocked, false) AS blocked,
            cv.state AS kyc_state,
            f.deposit_kyc, f.withdraw_kyc,
            COALESCE(f.frozen, false) AS frozen,
            ${activeWithdrawBanSql('f')} AS withdraw_banned,
            f.withdraw_ban_until, f.withdraw_ban_kind,
            s.deposit_requires_kyc, s.withdraw_requires_kyc,
            s.min_deposit_minor, s.min_withdraw_minor,
            s.unverified_withdraw_bps,
            f.unverified_withdraw_bps AS client_unverified_withdraw_bps
       FROM users u
       LEFT JOIN client_blocks cb ON cb.user_id = u.id
       LEFT JOIN client_verification cv ON cv.user_id = u.id
       LEFT JOIN client_money_flags f ON f.user_id = u.id
       LEFT JOIN platform_money_settings s ON s.id = 1
      WHERE u.id = $1`,
    [userId],
  );
  const row = r.rows[0];
  if (!row) {
    return {
      clientExists: false,
      blocked: false,
      kycVerified: false,
      settings: { ...DEFAULT_PLATFORM_SETTINGS },
      flags: { ...DEFAULT_CLIENT_FLAGS },
    };
  }
  const hasSettings = row.deposit_requires_kyc !== null && row.deposit_requires_kyc !== undefined;
  return {
    clientExists: true,
    blocked: Boolean(row.blocked),
    kycVerified: row.kyc_state === 'verified',
    settings: hasSettings
      ? {
          depositRequiresKyc: Boolean(row.deposit_requires_kyc),
          withdrawRequiresKyc: Boolean(row.withdraw_requires_kyc),
          minDepositMinor: Number(row.min_deposit_minor),
          minWithdrawMinor: Number(row.min_withdraw_minor),
          unverifiedWithdrawBps: bpsOr(row.unverified_withdraw_bps, 0),
        }
      : { ...DEFAULT_PLATFORM_SETTINGS },
    flags: {
      depositKyc: asKyc(row.deposit_kyc),
      withdrawKyc: asKyc(row.withdraw_kyc),
      frozen: Boolean(row.frozen),
      withdrawBanned: Boolean(row.withdraw_banned),
    },
    withdrawBanUntil: row.withdraw_banned ? isoOrNull(row.withdraw_ban_until) : null,
    withdrawBanKind: row.withdraw_banned ? asBanKind(row.withdraw_ban_kind) : null,
    unverifiedWithdrawBpsOverride: bpsOverride(row.client_unverified_withdraw_bps),
  };
}

export async function resolveMoneyPolicy(userId: string, db: Queryable): Promise<MoneyPolicy> {
  return computeMoneyPolicy(await loadMoneyPolicyInputs(db, userId));
}
