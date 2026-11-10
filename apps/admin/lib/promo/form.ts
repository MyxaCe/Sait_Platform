import { parseUsdtAmountToCents } from '@broker/money';
import type { PromotionInput } from '@broker/promo';

/**
 * Форма акции ⇄ правила. Оператор вводит привычное (проценты, USDT, дни),
 * здесь это переводится в форму правил (б.п., минорные единицы) — и обратно
 * для формы изменения. Валидацию правил делает пакет (`parseRules`), здесь —
 * только разбор чисел: нечисло → поле остаётся «плохим», и схема его отвергнет.
 *
 * Даты — UTC (поле `datetime-local` без пояса трактуется как UTC; подпись
 * поля говорит об этом оператору).
 */

type Fd = { get(name: string): FormDataEntryValue | null };

const str = (fd: Fd, k: string) => String(fd.get(k) ?? '').trim();
const bool = (fd: Fd, k: string) => fd.get(k) === 'on';

/** USDT → центы; '' → 0; мусор → NaN (схема отвергнет). */
export function usdtField(fd: Fd, k: string): number {
  const v = str(fd, k).replace(/\s/g, '');
  if (v === '' || /^0+(?:[.,]0{0,2})?$/.test(v)) return 0;
  const p = parseUsdtAmountToCents(v);
  return p.ok ? p.cents : Number.NaN;
}

/** «30» / «0,15» (%) → б.п. */
export function percentField(fd: Fd, k: string): number {
  const v = str(fd, k).replace(',', '.');
  if (v === '') return Number.NaN;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
}

export function intField(fd: Fd, k: string): number {
  const v = str(fd, k);
  if (v === '') return Number.NaN;
  const n = Number(v);
  return Number.isInteger(n) ? n : Number.NaN;
}

function numField(fd: Fd, k: string): number {
  const v = str(fd, k).replace(',', '.');
  if (v === '') return Number.NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function countriesField(fd: Fd, k: string): string[] {
  return str(fd, k)
    .split(/[\s,;]+/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** `datetime-local` (UTC) → ISO; '' → null; мусор → 'invalid' (сломает период). */
export function dateField(fd: Fd, k: string): string | null {
  const v = str(fd, k);
  if (!v) return null;
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`);
  return Number.isNaN(t) ? 'invalid' : new Date(t).toISOString();
}

/** Призы «1: 500» по строкам → [{place, amountMinor}]. */
export function prizesField(fd: Fd, k: string): { place: number; amountMinor: number }[] {
  return str(fd, k)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^(\d+)\s*[:=—-]\s*([\d\s.,]+)$/.exec(line);
      if (!m) return { place: Number.NaN, amountMinor: Number.NaN };
      const p = parseUsdtAmountToCents(m[2]!.replace(/\s/g, ''));
      return { place: Number(m[1]), amountMinor: p.ok ? p.cents : Number.NaN };
    });
}

export function rulesFromForm(type: string, fd: Fd): unknown {
  switch (type) {
    case 'deposit_bonus':
      return {
        percentBps: percentField(fd, 'percent'),
        capMinor: usdtField(fd, 'cap'),
        minDepositMinor: usdtField(fd, 'minDeposit'),
        firstDepositOnly: bool(fd, 'firstDepositOnly'),
        kycRequired: bool(fd, 'kycRequired'),
        turnoverMultiplier: numField(fd, 'turnoverMultiplier'),
        minHoldSeconds: intField(fd, 'minHoldSeconds'),
        windowDays: intField(fd, 'windowDays'),
        forfeitOnWithdrawal: bool(fd, 'forfeitOnWithdrawal'),
      };
    case 'referral':
      return {
        referrerRewardMinor: usdtField(fd, 'referrerReward'),
        refereeRewardMinor: usdtField(fd, 'refereeReward'),
        kycRequired: bool(fd, 'kycRequired'),
        minDepositMinor: usdtField(fd, 'minDeposit'),
        turnoverNotionalMinor: usdtField(fd, 'turnoverNotional'),
        minHoldSeconds: intField(fd, 'minHoldSeconds'),
        windowDays: intField(fd, 'windowDays'),
        maxPaidReferralsPerMonth: intField(fd, 'maxPaidReferralsPerMonth'),
        forfeitOnWithdrawal: bool(fd, 'forfeitOnWithdrawal'),
      };
    case 'cashback':
      return {
        percentBps: percentField(fd, 'percent'),
        minPayoutMinor: usdtField(fd, 'minPayout'),
        capPerPeriodMinor: usdtField(fd, 'capPerPeriod'),
        kycRequired: bool(fd, 'kycRequired'),
      };
    case 'contest':
      return {
        startBalanceMinor: usdtField(fd, 'startBalance'),
        minTrades: intField(fd, 'minTrades'),
        prizes: prizesField(fd, 'prizes'),
        prizeRequiresKyc: bool(fd, 'prizeRequiresKyc'),
        disqualifyOnReset: bool(fd, 'disqualifyOnReset'),
      };
    default:
      return {};
  }
}

export function textsFromForm(fd: Fd): Record<string, { title: string; summary: string; terms: string }> {
  const out: Record<string, { title: string; summary: string; terms: string }> = {};
  for (const loc of ['ru', 'en']) {
    const title = str(fd, `${loc}_title`);
    const summary = str(fd, `${loc}_summary`);
    const terms = str(fd, `${loc}_terms`);
    if (title || summary || terms) out[loc] = { title, summary, terms };
  }
  return out;
}

export function promotionFromForm(fd: Fd, type: string): PromotionInput {
  return {
    slug: str(fd, 'slug'),
    type: type as PromotionInput['type'],
    title: str(fd, 'title'),
    cmsPromoId: str(fd, 'cmsPromoId') || null,
    rules: rulesFromForm(type, fd),
    texts: textsFromForm(fd),
    startsAt: dateField(fd, 'startsAt'),
    endsAt: dateField(fd, 'endsAt'),
    budgetMinor: usdtField(fd, 'budget'),
    countriesAllow: countriesField(fd, 'countriesAllow'),
    countriesDeny: countriesField(fd, 'countriesDeny'),
  };
}

/* ── Обратно: правила → значения полей формы изменения ─────────────────── */

const usdt = (minor: unknown) => (typeof minor === 'number' ? (minor / 100).toFixed(2) : '');
const pct = (bps: unknown) => (typeof bps === 'number' ? String(bps / 100) : '');
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));

export type FormValues = Record<string, string | boolean>;

export function formValuesFromRules(type: string, rules: unknown): FormValues {
  const r = (rules ?? {}) as Record<string, unknown>;
  switch (type) {
    case 'deposit_bonus':
      return {
        percent: pct(r.percentBps),
        cap: usdt(r.capMinor),
        minDeposit: usdt(r.minDepositMinor),
        firstDepositOnly: r.firstDepositOnly === true,
        kycRequired: r.kycRequired === true,
        turnoverMultiplier: s(r.turnoverMultiplier),
        minHoldSeconds: s(r.minHoldSeconds),
        windowDays: s(r.windowDays),
        forfeitOnWithdrawal: r.forfeitOnWithdrawal === true,
      };
    case 'referral':
      return {
        referrerReward: usdt(r.referrerRewardMinor),
        refereeReward: usdt(r.refereeRewardMinor),
        kycRequired: r.kycRequired === true,
        minDeposit: usdt(r.minDepositMinor),
        turnoverNotional: usdt(r.turnoverNotionalMinor),
        minHoldSeconds: s(r.minHoldSeconds),
        windowDays: s(r.windowDays),
        maxPaidReferralsPerMonth: s(r.maxPaidReferralsPerMonth),
        forfeitOnWithdrawal: r.forfeitOnWithdrawal === true,
      };
    case 'cashback':
      return {
        percent: pct(r.percentBps),
        minPayout: usdt(r.minPayoutMinor),
        capPerPeriod: usdt(r.capPerPeriodMinor),
        kycRequired: r.kycRequired === true,
      };
    case 'contest':
      return {
        startBalance: usdt(r.startBalanceMinor),
        minTrades: s(r.minTrades),
        prizes: Array.isArray(r.prizes)
          ? (r.prizes as { place: number; amountMinor: number }[])
              .map((p) => `${p.place}: ${(p.amountMinor / 100).toFixed(2)}`)
              .join('\n')
          : '',
        prizeRequiresKyc: r.prizeRequiresKyc === true,
        disqualifyOnReset: r.disqualifyOnReset === true,
      };
    default:
      return {};
  }
}

/** ISO → значение `datetime-local` (UTC, минуты). */
export function toLocalInput(iso: string | null): string {
  return iso ? iso.slice(0, 16) : '';
}
