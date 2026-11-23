import { getLocale, getTranslations } from 'next-intl/server';
import { Callout } from '@broker/ui';
import type { KycAllowance, MoneyPolicy } from '@broker/money';
import { REAL_ACCOUNT_CURRENCY } from '@broker/money/display-currency';
import { Link } from '@/i18n/navigation';
import { WithdrawForm } from './MoneyForms';
import { PolicyNotice } from './PolicyNotice';
import { moneyFormat } from '@/features/ui/money-format';
import { isTwoFactorEnabled } from '@broker/support';
import { twoFactorPool } from '@/lib/two-factor';

export async function WithdrawPanel({
  policy,
  availableMinor,
  kycAllowance = null,
  userId,
}: {
  policy: MoneyPolicy;
  availableMinor: number;
  kycAllowance?: KycAllowance | null;
  userId?: string;
}) {
  const twoFactor = userId ? await isTwoFactorEnabled(twoFactorPool(), userId) : false;
  const fmt = moneyFormat(await getLocale());
  const t = await getTranslations('money');
  const reasons = policy.withdrawReasons.filter((r) => !(policy.frozen && r === 'frozen'));
  const notice = !policy.withdrawAllowed && reasons.length > 0;
  const limited = policy.withdrawAllowed && policy.withdrawKycLimited;
  const exhausted =
    limited && (kycAllowance === null || kycAllowance.remainingMinor < Math.max(1, policy.minWithdrawMinor));
  const formAvailable =
    limited && kycAllowance ? Math.min(availableMinor, kycAllowance.remainingMinor) : availableMinor;
  const money = (minor: number) => fmt.money(minor, REAL_ACCOUNT_CURRENCY);
  const limitText = !limited
    ? null
    : kycAllowance === null
      ? t('kycLimit.unknown', { percent: String(policy.unverifiedWithdraw.bps / 100) })
      : kycAllowance.remainingMinor > 0
        ? t('kycLimit.remaining', {
            remaining: money(kycAllowance.remainingMinor),
            limit: money(kycAllowance.limitMinor),
          })
        : t('kycLimit.exhausted', { limit: money(kycAllowance.limitMinor) });
  return (
    <div className="space-y-4 sm:space-y-5 xl:grid xl:grid-cols-2 xl:items-stretch xl:gap-5 xl:space-y-0">
      {notice ? (
        <div className="xl:col-span-2">
          <PolicyNotice op="withdraw" reasons={reasons} banUntil={policy.withdrawBanUntil} />
        </div>
      ) : null}
      {limitText ? (
        <div className="xl:col-span-2" data-kyc-limit={kycAllowance ? kycAllowance.remainingMinor : 'unknown'}>
          <Callout tone={exhausted ? 'warning' : 'info'} title={t('kycLimit.title')}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p>{limitText}</p>
              <Link
                href="/profile?tab=verification"
                className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-lg bg-accent px-3.5 text-sm font-medium text-on-accent hover:bg-accent-hover"
              >
                {t('goVerify')}
              </Link>
            </div>
          </Callout>
        </div>
      ) : null}
      <section className="h-full rounded-2xl border border-border bg-elevated p-4 sm:p-5">
        <WithdrawForm
          disabled={!policy.withdrawAllowed || exhausted}
          availableMinor={formAvailable}
          minMinor={policy.minWithdrawMinor}
          twoFactor={twoFactor}
        />
        <p className="mt-4 text-xs leading-relaxed text-muted">{t('withdrawNote')}</p>
      </section>
      <section className="hidden h-full rounded-2xl border border-border bg-elevated p-4 sm:p-5 xl:block" aria-labelledby="wd-guide">
        <h2 id="wd-guide" className="text-[15px] font-semibold">
          {t('guideTitle')}
        </h2>
        <ol className="mt-4 space-y-3">
          {(['address', 'reserve', 'review', 'sent'] as const).map((k, i) => (
            <li key={k} className="flex gap-3 text-sm">
              <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border-strong text-xs font-semibold text-secondary">
                {i + 1}
              </span>
              <span>
                <span className="block font-medium">{t(`guide.${k}.title`)}</span>
                <span className="block text-xs leading-relaxed text-secondary">{t(`guide.${k}.text`)}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
