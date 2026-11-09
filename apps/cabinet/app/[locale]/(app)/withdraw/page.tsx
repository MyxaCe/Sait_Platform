import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireSessionUser } from '@/lib/auth/require';
import { getMoneyPolicy, getRealAccount, listMyWithdrawals } from '@/lib/money';
import { WithdrawForm } from '@/features/money/MoneyForms';
import { WithdrawalHistory } from '@/features/money/MoneyHistory';

/**
 * «Вывести» с реального счёта (дизайн §2): адрес TRON (base58check), сумма ≥
 * минимума, политика. Сумма резервируется в терминале сразу при подаче;
 * свободную маржу проверяет терминал, его отказ виден человеку.
 */
export const dynamic = 'force-dynamic';

export default async function WithdrawPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const user = await requireSessionUser(params.locale);
  const t = await getTranslations('money');
  const [policy, account, withdrawals] = await Promise.all([
    getMoneyPolicy(user.id),
    getRealAccount(user.id),
    listMyWithdrawals(user.id),
  ]);
  const reasons = policy.withdrawReasons.map((r) => (t.has(`policy.${r}`) ? t(`policy.${r}`) : r)).join(', ');

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">{t('withdrawTitle')}</h1>

      {!policy.withdrawAllowed ? (
        <p role="alert" className="rounded-xl border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {t('unavailable', { reasons })}
        </p>
      ) : null}

      <section className="space-y-3 rounded-2xl border border-border bg-elevated p-5">
        <p className="text-sm font-semibold">{t('network')}</p>
        <p className="text-sm">
          {t('balance', { amount: ((account?.balanceCents ?? 0) / 100).toFixed(2) })}
        </p>
        <p className="text-xs text-secondary">{t('minWithdraw', { min: (policy.minWithdrawMinor / 100).toFixed(2) })}</p>
        <WithdrawForm disabled={!policy.withdrawAllowed} />
      </section>

      <WithdrawalHistory items={withdrawals} />
    </div>
  );
}
