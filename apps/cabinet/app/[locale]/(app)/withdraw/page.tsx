import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Callout, Money } from '@broker/ui';
import { requireSessionUser } from '@/lib/auth/require';
import { getMoneyPolicy, getRealAccount, listMyWithdrawals, terminalReader } from '@/lib/money';
import { WithdrawForm } from '@/features/money/MoneyForms';
import { WithdrawalHistory } from '@/features/money/MoneyHistory';
import { PolicyNotice } from '@/features/money/PolicyNotice';
import { MoneyPageHeader } from '@/features/money/Step';

/**
 * «Вывести» с реального счёта (дизайн §2), фаза 2: доступная сумма (свободная
 * маржа терминала; терминал молчит — баланс с оговоркой), адрес TRON с
 * проверкой формата, сумма с «Макс.», шаг подтверждения перед отправкой.
 * Сумма резервируется в терминале при подаче; свободную маржу окончательно
 * проверяет терминал, его отказ виден человеку.
 */
export const dynamic = 'force-dynamic';

export default async function WithdrawPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const user = await requireSessionUser(params.locale);
  const t = await getTranslations('money');
  const th = await getTranslations('home');
  const [policy, account, withdrawals, live] = await Promise.all([
    getMoneyPolicy(user.id),
    getRealAccount(user.id),
    listMyWithdrawals(user.id),
    terminalReader()
      .accounts(user.id)
      .catch(() => ({ state: 'unavailable' as const })),
  ]);
  const real = live.state === 'ok' ? live.accounts.find((a) => a.kind === 'real') : undefined;
  const freeMargin = real?.opened ? real.freeMarginMinor : null;
  const balance = account?.balanceCents ?? 0;
  // Доступно = свободная маржа (не больше баланса); терминал молчит — баланс.
  const available = freeMargin !== null ? Math.max(0, Math.min(freeMargin, balance)) : balance;
  const currency = account?.currency ?? 'USDT';

  return (
    <div className="mx-auto max-w-2xl space-y-4 sm:space-y-5">
      <MoneyPageHeader title={t('withdrawTitle')} lead={t('withdrawLead')} />

      {policy.frozen ? (
        <Callout tone="negative" title={th('realFrozenTitle')}>
          {th('realFrozen')}
        </Callout>
      ) : null}
      {!policy.withdrawAllowed ? (
        <PolicyNotice
          op="withdraw"
          reasons={policy.withdrawReasons.filter((r) => !(policy.frozen && r === 'frozen'))}
        />
      ) : null}

      <section className="rounded-2xl border border-border bg-elevated p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-border pb-4">
          <div className="min-w-0">
            <p className="text-xs text-muted">{t('availableLabel')}</p>
            <p className="mt-0.5 text-[22px] font-semibold leading-8 tracking-tight">
              <Money minor={available} currency={currency} />
            </p>
          </div>
          <div className="min-w-0 text-right">
            <p className="text-xs text-muted">{t('balanceLabel')}</p>
            <p className="mt-0.5 text-[15px] font-medium leading-8">
              <Money minor={balance} currency={currency} />
            </p>
          </div>
          <p className="col-span-2 text-xs text-secondary">
            {freeMargin !== null ? t('availableHint') : t('availableFallbackHint')}
          </p>
        </div>
        <div className="pt-4">
          <WithdrawForm
            disabled={!policy.withdrawAllowed}
            availableMinor={available}
            minMinor={policy.minWithdrawMinor}
          />
          <p className="mt-4 text-xs leading-relaxed text-muted">{t('withdrawNote')}</p>
        </div>
      </section>

      <WithdrawalHistory items={withdrawals} />
    </div>
  );
}
