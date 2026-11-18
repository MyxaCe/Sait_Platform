import { z } from 'zod';

export const PROMOTION_TYPES = ['deposit_bonus', 'cashback', 'contest', 'referral'] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];

export const PROMOTION_STATUSES = ['draft', 'active', 'paused', 'ended'] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

const minor = z.number().int().nonnegative().max(1_000_000_000_00);
const positiveMinor = z.number().int().positive().max(1_000_000_000_00);
const bps = z.number().int().min(0).max(10_000);
const days = z.number().int().min(1).max(3650);
const seconds = z.number().int().min(0).max(30 * 86_400);

export const depositBonusRules = z
  .object({
    percentBps: bps.refine((v) => v > 0, 'percent must be > 0'),
    capMinor: positiveMinor,
    minDepositMinor: minor,
    firstDepositOnly: z.boolean(),
    kycRequired: z.boolean(),
    turnoverMultiplier: z.number().min(0).max(1000),
    minHoldSeconds: seconds,
    windowDays: days,
    forfeitOnWithdrawal: z.boolean(),
  })
  .strict();
export type DepositBonusRules = z.infer<typeof depositBonusRules>;

export const referralRules = z
  .object({
    referrerRewardMinor: minor,
    refereeRewardMinor: minor,
    kycRequired: z.boolean(),
    minDepositMinor: minor,
    turnoverNotionalMinor: minor,
    minHoldSeconds: seconds,
    windowDays: days,
    maxPaidReferralsPerMonth: z.number().int().min(0).max(10_000),
    forfeitOnWithdrawal: z.boolean(),
  })
  .strict()
  .refine((r) => r.referrerRewardMinor > 0 || r.refereeRewardMinor > 0, {
    message: 'хотя бы одна награда должна быть больше нуля',
  });
export type ReferralRules = z.infer<typeof referralRules>;

export const cashbackRules = z
  .object({
    percentBps: bps.refine((v) => v > 0, 'percent must be > 0'),
    minPayoutMinor: minor,
    capPerPeriodMinor: minor,
    kycRequired: z.boolean(),
  })
  .strict();
export type CashbackRules = z.infer<typeof cashbackRules>;

export const contestPrize = z.object({ place: z.number().int().min(1).max(1000), amountMinor: positiveMinor }).strict();

export const contestRules = z
  .object({
    startBalanceMinor: positiveMinor,
    minTrades: z.number().int().min(0).max(100_000),
    prizes: z.array(contestPrize).min(1).max(100),
    prizeRequiresKyc: z.boolean(),
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

export function parseRules(type: string, raw: unknown): RulesParse {
  if (!isPromotionType(type)) return { ok: false, issues: [`неизвестный тип акции: ${type}`] };
  const r = SCHEMAS[type].safeParse(raw);
  if (!r.success) {
    return { ok: false, issues: r.error.issues.map((i) => `${i.path.join('.') || '(rules)'}: ${i.message}`) };
  }
  return { ok: true, value: { type, rules: r.data } as ParsedRules };
}

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

export function parseTexts(raw: unknown): PromoTexts {
  const r = promoTextsSchema.safeParse(raw ?? {});
  return r.success ? r.data : {};
}

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
