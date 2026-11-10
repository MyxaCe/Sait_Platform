import { useLocale, useTranslations } from 'next-intl';
import { cn, formatMoney } from '@broker/ui';
import type { PublicRules } from '@broker/promo';
import { bpsPercent, holdParts, PROMO_CURRENCY } from './format';

/**
 * Числа правил человеческими словами: ВСЁ — из `PublicRules` (админка).
 * Возвращает список строк — тот же источник для карточки («ключевое условие»
 * — первые строки) и для раскрывающихся полных условий.
 */
export function useRuleLines(rules: PublicRules | null): string[] {
  const t = useTranslations('promo.rules');
  const locale = useLocale();
  if (!rules) return [];
  const usdt = (m: number) => formatMoney(m, PROMO_CURRENCY);
  switch (rules.type) {
    case 'deposit_bonus': {
      const out = [t('bonus', { percent: bpsPercent(rules.percentBps, locale), cap: usdt(rules.capMinor) })];
      out.push(
        rules.firstDepositOnly
          ? `${t('minDeposit', { amount: usdt(rules.minDepositMinor) })} · ${t('firstDepositOnly')}`
          : t('minDeposit', { amount: usdt(rules.minDepositMinor) }),
      );
      if (rules.turnoverMultiplier > 0) out.push(t('turnoverMultiplier', { multiplier: rules.turnoverMultiplier }));
      if (rules.minHoldSeconds > 0) out.push(t('hold', holdParts(rules.minHoldSeconds)));
      out.push(t('window', { days: rules.windowDays }));
      if (rules.kycRequired) out.push(t('kyc'));
      if (rules.forfeitOnWithdrawal) out.push(t('forfeit'));
      return out;
    }
    case 'cashback': {
      const out = [t('cashbackRate', { percent: bpsPercent(rules.percentBps, locale) }), t('cashbackPeriod')];
      if (rules.minPayoutMinor > 0) out.push(t('minPayout', { amount: usdt(rules.minPayoutMinor) }));
      if (rules.capPerPeriodMinor > 0) out.push(t('capPerPeriod', { amount: usdt(rules.capPerPeriodMinor) }));
      if (rules.kycRequired) out.push(t('kyc'));
      return out;
    }
    case 'contest': {
      const pool = rules.prizes.reduce((s, p) => s + p.amountMinor, 0);
      const out: string[] = [];
      if (pool > 0) out.push(t('prizePool', { amount: usdt(pool) }));
      out.push(t('minTrades', { n: rules.minTrades }));
      if (rules.prizeRequiresKyc) out.push(t('prizeKyc'));
      return out;
    }
    case 'referral':
      return [];
  }
}

/** Маркированный список правил. */
export function RulesList({ lines, className }: { lines: string[]; className?: string }) {
  if (lines.length === 0) return null;
  return (
    <ul className={cn('space-y-1.5 text-sm text-secondary', className)}>
      {lines.map((l) => (
        <li key={l} className="flex gap-2">
          <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-muted" />
          <span>{l}</span>
        </li>
      ))}
    </ul>
  );
}

/** Полные условия: правила + текст из админки. Раскрывающийся блок (без JS). */
export function FullTerms({ lines, terms, label }: { lines: string[]; terms: string; label: string }) {
  if (lines.length === 0 && !terms.trim()) return null;
  return (
    <details className="group rounded-xl border border-border bg-card [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex min-h-[44px] cursor-pointer select-none items-center justify-between gap-2 px-3.5 text-sm font-medium text-primary">
        {label}
        <svg
          viewBox="0 0 20 20"
          aria-hidden
          className="size-4 shrink-0 text-secondary transition-transform group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="m5.5 8 4.5 4.5L14.5 8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="space-y-3 border-t border-border px-3.5 py-3">
        <RulesList lines={lines} />
        {terms.trim() ? <p className="whitespace-pre-line text-sm text-secondary">{terms}</p> : null}
      </div>
    </details>
  );
}
