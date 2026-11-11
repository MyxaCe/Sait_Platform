import type { Queryable } from './db';

/**
 * Денежная политика клиента — ОДИН резолвер на кабинет и админку
 * (`resolveMoneyPolicy`). Кабинет решает по нему, активна ли кнопка
 * «Пополнить/Вывести» и принимать ли заявку; админка показывает то же
 * итоговое значение и его источник. Два места решения разошлись бы.
 *
 * Гейты (дизайн §0, §3):
 *  - блокировка клиента — нет ни ввода, ни вывода (и входа нет вовсе);
 *  - «Заморозка счёта» — нет вывода (и торговли на реальном счёте); ввод
 *    НЕ закрыт: деньги, пришедшие в сеть, всё равно надо зачислить;
 *  - «Запрет вывода» — нет вывода;
 *  - KYC: ввод/вывод «только после KYC» — платформа (по умолчанию: ввод
 *    нет, вывод да) или индивидуально у клиента (inherit/required/
 *    not_required). Проверка KYC = `client_verification.state = 'verified'`
 *    (та же логика, что `isKycVerified` в кабинете), иначе fail-closed.
 *  - Вывод без KYC в пределах доли (ветка demo-withdraw-limits): если вывод
 *    «только после KYC», клиент не верифицирован и действующая доля
 *    `unverifiedWithdrawBps` > 0 — вывод НЕ закрыт, а ограничен суммарным
 *    потолком (`withdrawKycLimited`; сумму проверяет `requestWithdrawal`,
 *    формула — `kyc-allowance.ts`). Доля 0 — прежнее поведение (`kyc_required`).
 */

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
  /**
   * Сколько можно вывести БЕЗ верификации — доля «баланса до выводов» в б.п.
   * (500 = 5 %), суммарно за всё время. 0 — без верификации вывода нет.
   */
  unverifiedWithdrawBps: number;
}

/** Предел доли вывода без верификации: 10 000 б.п. = 100 %. */
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

/**
 * Происхождение «Запрета вывода» (миграция 1795520000000): поставлен в
 * денежных флагах, менеджером по распоряжению или автозаморозкой после смены
 * учётных данных. Сущность одна — флаг `withdraw_banned`; здесь только срок и
 * источник, чтобы клиенту и оператору показать «до …» и кто может снять.
 */
export type WithdrawBanKind = 'money_flags' | 'credentials_manual' | 'credentials_auto';

export interface MoneyPolicyInputs {
  clientExists: boolean;
  blocked: boolean;
  kycVerified: boolean;
  settings: PlatformMoneySettings;
  /** `withdrawBanned` — ДЕЙСТВУЮЩИЙ запрет (истёкший срок уже учтён в SQL). */
  flags: ClientMoneyFlags;
  /** Срок действующего запрета вывода; `null` — бессрочно или запрета нет. */
  withdrawBanUntil?: string | null;
  withdrawBanKind?: WithdrawBanKind | null;
  /** Доля вывода без KYC у клиента (б.п.); `null`/нет — наследовать из платформы. */
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
  /** Торговля на РЕАЛЬНОМ счёте (SSO с account_kind=real). Демо не гейтится. */
  realTradingAllowed: boolean;
  /** Все причины ограничений (объединение). */
  reasons: MoneyPolicyReason[];
  depositReasons: MoneyPolicyReason[];
  withdrawReasons: MoneyPolicyReason[];
  depositKyc: EffectiveKyc;
  withdrawKyc: EffectiveKyc;
  kycVerified: boolean;
  blocked: boolean;
  frozen: boolean;
  withdrawBanned: boolean;
  /** До какого момента действует запрет вывода (`null` — бессрочно / нет запрета). */
  withdrawBanUntil: string | null;
  withdrawBanKind: WithdrawBanKind | null;
  minDepositMinor: number;
  minWithdrawMinor: number;
  /** Действующая доля вывода без верификации и её источник (показывается всегда). */
  unverifiedWithdraw: EffectiveBps;
  /**
   * Вывод разрешён, но ТОЛЬКО в пределах доли без верификации: KYC нужен, не
   * пройден, доля > 0. Сумму проверяет сервер при подаче заявки.
   */
  withdrawKycLimited: boolean;
}

function effectiveKyc(flag: KycSetting, platform: boolean): EffectiveKyc {
  if (flag === 'inherit') return { required: platform, source: 'platform' };
  return { required: flag === 'required', source: 'client' };
}

/** Чистая функция политики — все комбинации гейтов проверяются на ней. */
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
    // Лимит имеет смысл, только пока вывод вообще открыт иными гейтами.
    withdrawKycLimited: withdrawKycLimited && withdrawReasons.length === 0,
  };
}

function asKyc(v: unknown): KycSetting {
  return v === 'required' || v === 'not_required' ? v : 'inherit';
}

/**
 * Действующий «Запрет вывода» в SQL (алиас таблицы флагов — параметр). Запрет
 * со сроком (`withdraw_ban_until`) сам перестаёт действовать, когда срок
 * прошёл: снимать его фоновой задачей не нужно, а истёкший запрет не может
 * «залипнуть». Одно выражение на кабинет, админку и поддержку.
 */
export function activeWithdrawBanSql(alias: string): string {
  return `COALESCE(${alias}.withdraw_banned AND (${alias}.withdraw_ban_until IS NULL OR ${alias}.withdraw_ban_until > now()), false)`;
}

function asBanKind(v: unknown): WithdrawBanKind {
  return v === 'credentials_manual' || v === 'credentials_auto' ? v : 'money_flags';
}

/** Доля в б.п. из базы; мусор/вне диапазона → `fallback` (CHECK в базе это исключает). */
function bpsOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= MAX_UNVERIFIED_WITHDRAW_BPS ? n : fallback;
}

/** Переопределение у клиента: `null` — наследовать; мусор — 0 (fail-closed: строже). */
function bpsOverride(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return bpsOr(v, 0);
}

const isoOrNull = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

/** Настройки платформы (строка-синглтон; нет строки — умолчания миграции). */
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

/** Входы политики из базы — одним запросом (согласованный снимок). */
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
          // Нет/мусор → 0: без верификации вывода нет (строже, fail-closed).
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
