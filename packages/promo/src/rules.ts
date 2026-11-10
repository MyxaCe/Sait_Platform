import { z } from 'zod';

/**
 * ПРАВИЛА АКЦИЙ — одна схема на запись (админка) и чтение (движок, кабинет).
 *
 * Сквозной принцип владельца (10.11): ни одного числа акции в коде. Всё, что
 * ниже, — ФОРМА правил; значения задаёт админка, хранит `promotions.rules`.
 * Запись строгая (`parseRules` отвергает лишнее и неверное), чтение — тоже
 * через схему: испорченная строка не превращается в «ноль» молча, а
 * показывается оператору как ошибка правил (`ok: false`).
 *
 * Деньги — целые минорные единицы (центы USD; 1 USDT = 100). Проценты —
 * базисные пункты (10 000 = 100 %). Время — секунды/дни, целые.
 */

export const PROMOTION_TYPES = ['deposit_bonus', 'cashback', 'contest', 'referral'] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];

export const PROMOTION_STATUSES = ['draft', 'active', 'paused', 'ended'] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

const minor = z.number().int().nonnegative().max(1_000_000_000_00);
const positiveMinor = z.number().int().positive().max(1_000_000_000_00);
const bps = z.number().int().min(0).max(10_000);
const days = z.number().int().min(1).max(3650);
const seconds = z.number().int().min(0).max(30 * 86_400);

/** Бонус на депозит: % от депозита деньгами ПОСЛЕ условий (вариант C). */
export const depositBonusRules = z
  .object({
    /** Процент от депозита-основания, б.п. (3000 = 30 %). */
    percentBps: bps.refine((v) => v > 0, 'percent must be > 0'),
    /** Потолок вознаграждения на клиента. */
    capMinor: positiveMinor,
    /** Минимальный депозит-основание. */
    minDepositMinor: minor,
    /** Основание — только первый зачисленный депозит клиента. */
    firstDepositOnly: z.boolean(),
    kycRequired: z.boolean(),
    /** Оборот нотионалом ≥ k × вознаграждения (30 = 30×). 0 — без оборота. */
    turnoverMultiplier: z.number().min(0).max(1000),
    /** Сделка засчитывается, если позиция удержана ≥ N секунд. */
    minHoldSeconds: seconds,
    /** Срок выполнения условий со дня вступления. */
    windowDays: days,
    /** Вывод средств до выплаты аннулирует участие. */
    forfeitOnWithdrawal: z.boolean(),
  })
  .strict();
export type DepositBonusRules = z.infer<typeof depositBonusRules>;

/** «Пригласи друга»: награда обоим после условий друга. */
export const referralRules = z
  .object({
    referrerRewardMinor: minor,
    refereeRewardMinor: minor,
    kycRequired: z.boolean(),
    /** Первый депозит друга не меньше. */
    minDepositMinor: minor,
    /** Оборот друга нотионалом (абсолютный, минорные единицы USD). */
    turnoverNotionalMinor: minor,
    minHoldSeconds: seconds,
    /** Срок выполнения — со дня регистрации друга. */
    windowDays: days,
    /** Оплачиваемых друзей на реферера в календарный месяц. 0 — без лимита. */
    maxPaidReferralsPerMonth: z.number().int().min(0).max(10_000),
    forfeitOnWithdrawal: z.boolean(),
  })
  .strict()
  .refine((r) => r.referrerRewardMinor > 0 || r.refereeRewardMinor > 0, {
    message: 'хотя бы одна награда должна быть больше нуля',
  });
export type ReferralRules = z.infer<typeof referralRules>;

/** Кешбэк: % от уплаченной клиентом наценки + комиссии за календарный месяц. */
export const cashbackRules = z
  .object({
    percentBps: bps.refine((v) => v > 0, 'percent must be > 0'),
    /** Начислять, только если сам кешбэк за период не меньше. */
    minPayoutMinor: minor,
    /** Потолок на клиента за период. 0 — без потолка. */
    capPerPeriodMinor: minor,
    kycRequired: z.boolean(),
  })
  .strict();
export type CashbackRules = z.infer<typeof cashbackRules>;

export const contestPrize = z.object({ place: z.number().int().min(1).max(1000), amountMinor: positiveMinor }).strict();

/** Турнир на демо-счетах: доходность за период, призы реальными USDT. */
export const contestRules = z
  .object({
    /** Ожидаемая сумма демо после сброса (сверяется с фактической базой). */
    startBalanceMinor: positiveMinor,
    /** Минимум закрытых сделок в окне, чтобы попасть в зачёт. */
    minTrades: z.number().int().min(0).max(100_000),
    prizes: z.array(contestPrize).min(1).max(100),
    /** Приз выплачивается только верифицированному (KYC). */
    prizeRequiresKyc: z.boolean(),
    /** Повторный сброс демо во время конкурса — дисквалификация. */
    disqualifyOnReset: z.boolean(),
  })
  .strict()
  .refine((r) => new Set(r.prizes.map((p) => p.place)).size === r.prizes.length, {
    message: 'места призов не должны повторяться',
  });
export type ContestRules = z.infer<typeof contestRules>;

export interface RulesByType {
  deposit_bonus: DepositBonusRules;
  cashback: CashbackRules;
  contest: ContestRules;
  referral: ReferralRules;
}

const SCHEMAS: { [K in PromotionType]: z.ZodType<RulesByType[K]> } = {
  deposit_bonus: depositBonusRules,
  cashback: cashbackRules,
  contest: contestRules,
  referral: referralRules,
};

export type ParsedRules =
  | { type: 'deposit_bonus'; rules: DepositBonusRules }
  | { type: 'cashback'; rules: CashbackRules }
  | { type: 'contest'; rules: ContestRules }
  | { type: 'referral'; rules: ReferralRules };

export type RulesParse = { ok: true; value: ParsedRules } | { ok: false; issues: string[] };

export function isPromotionType(v: unknown): v is PromotionType {
  return typeof v === 'string' && (PROMOTION_TYPES as readonly string[]).includes(v);
}

/** Разбор правил по типу. Одна функция и для записи, и для чтения. */
export function parseRules(type: string, raw: unknown): RulesParse {
  if (!isPromotionType(type)) return { ok: false, issues: [`неизвестный тип акции: ${type}`] };
  const r = SCHEMAS[type].safeParse(raw);
  if (!r.success) {
    return { ok: false, issues: r.error.issues.map((i) => `${i.path.join('.') || '(rules)'}: ${i.message}`) };
  }
  return { ok: true, value: { type, rules: r.data } as ParsedRules };
}

/** Тексты для клиента по локалям — из админки, не из кода. */
export const promoTextsSchema = z.record(
  z.string().regex(/^[a-z]{2}$/),
  z
    .object({
      title: z.string().trim().min(1).max(160),
      summary: z.string().trim().max(600).default(''),
      terms: z.string().trim().max(8000).default(''),
    })
    .strict(),
);
export type PromoTexts = z.infer<typeof promoTextsSchema>;

/** Тексты акции; испорченные — пустой набор (кабинет покажет название из админки). */
export function parseTexts(raw: unknown): PromoTexts {
  const r = promoTextsSchema.safeParse(raw ?? {});
  return r.success ? r.data : {};
}

/** Код страны ISO-3166 alpha-2 (верхний регистр). */
export const COUNTRY_RE = /^[A-Z]{2}$/;

export function normalizeCountries(list: readonly string[]): string[] | null {
  const out = new Set<string>();
  for (const raw of list) {
    const c = raw.trim().toUpperCase();
    if (c === '') continue;
    if (!COUNTRY_RE.test(c)) return null;
    out.add(c);
  }
  return [...out].sort();
}

/** CPA-условия IB-партнёра — та же форма, что условия друга, без наград. */
export const ibCpaRules = z
  .object({
    kycRequired: z.boolean(),
    minDepositMinor: minor,
    turnoverNotionalMinor: minor,
    minHoldSeconds: seconds,
    windowDays: days,
  })
  .strict();
export type IbCpaRules = z.infer<typeof ibCpaRules>;
