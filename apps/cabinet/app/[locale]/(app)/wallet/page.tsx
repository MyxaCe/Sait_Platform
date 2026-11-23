import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Callout, cn } from '@broker/ui';
import { Money } from '@/features/ui/Money';
import { requireSessionUser } from '@/lib/auth/require';
import {
  exchangeAddress,
  getKycAllowance,
  getMoneyPolicy,
  getRealAccount,
  listMyDeposits,
  listMyWithdrawals,
  terminalReader,
} from '@/lib/money';
import { DepositPanel } from '@/features/money/DepositPanel';
import { WithdrawPanel } from '@/features/money/WithdrawPanel';
import { OperationsHistory } from '@/features/money/MoneyHistory';
import { NavIcon } from '@/features/shell/NavIcon';
import { realMoneyCurrency } from '@broker/money/display-currency';
import { Segmented } from '@/features/ui/Segmented';
import { PAGE } from '@/features/ui/page';
import { TransferNotice } from '@/features/transfer/TransferNotice';

export const dynamic = 'force-dynamic';

export default async function WalletPage({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams: { tab?: string };
}) {
  setRequestLocale(params.locale);
  const user = await requireSessionUser(params.locale);
  const t = await getTranslations('money');
  const th = await getTranslations('home');
  const tab = searchParams.tab === 'withdraw' ? 'withdraw' : 'deposit';

  const [policy, account, deposits, withdrawals, live] = await Promise.all([
    getMoneyPolicy(user.id),
    getRealAccount(user.id),
    listMyDeposits(user.id),
    listMyWithdrawals(user.id),
    terminalReader()
      .accounts(user.id)
      .catch(() => ({ state: 'unavailable' as const })),
  ]);
  const real = live.state === 'ok' ? live.accounts.find((a) => a.kind === 'real') : undefined;
  const freeMargin = real?.opened ? real.freeMarginMinor : null;
  const balance = account?.balanceCents ?? 0;
  const available = freeMargin !== null ? Math.max(0, Math.min(freeMargin, balance)) : balance;
  const currency = realMoneyCurrency(account?.currency);
  const kycAllowance =
    tab === 'withdraw' && policy.withdrawKycLimited ? await getKycAllowance(user.id, policy, live) : null;

  const balanceCard = (
    <section
      className="h-full rounded-2xl border border-accent/40 bg-elevated p-4 sm:p-5"
      aria-label={th('realAccountTitle')}
      data-account="real"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-secondary">{th('realAccountTitle')}</p>
        <span className="inline-flex h-[22px] items-center gap-1.5 rounded-md bg-accent/[0.14] px-2 text-xs font-semibold text-accent ring-1 ring-inset ring-accent/30">
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          {th('badgeReal')}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-xs text-muted">{t('balanceLabel')}</p>
          <p className="mt-0.5 text-[24px] font-semibold leading-8 tracking-tight">
            <Money minor={balance} currency={currency} />
          </p>
        </div>
        <div className="min-w-0 text-right">
          <p className="text-xs text-muted">{t('availableLabel')}</p>
          <p className="mt-0.5 text-[17px] font-medium leading-8">
            <Money minor={available} currency={currency} />
          </p>
        </div>
      </div>
      {tab === 'withdraw' ? (
        <p className="mt-2 text-xs text-secondary">
          {freeMargin !== null ? t('availableHint') : t('availableFallbackHint')}
        </p>
      ) : null}
    </section>
  );

  return (
    <div className={cn(PAGE, 'space-y-4 sm:space-y-5')}>
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t('walletTitle')}</h1>
        <p className="mt-1 text-sm text-secondary">{t('walletLead')}</p>
      </div>
      <TransferNotice userId={user.id} withWithdrawLink={tab !== 'withdraw'} />

      {/* Одна строка: действия (Пополнить / Вывести) слева, баланс справа — закреплён вверху. */}
      <div className="flex flex-col gap-4 sm:gap-5 xl:grid xl:grid-cols-2 xl:items-stretch" data-wallet-top>
        <div className="order-2 flex min-w-0 flex-col justify-center gap-4 xl:order-1 [&>nav>a]:xl:min-h-[52px]">
          {policy.frozen ? (
            <Callout tone="negative" title={th('realFrozenTitle')}>
              {th('realFrozen')}
            </Callout>
          ) : null}
          <Segmented
            label={t('walletTabs')}
            active={tab}
            items={[
              {
                key: 'deposit',
                href: '/wallet?tab=deposit',
                label: (
                  <>
                    <NavIcon name="deposit" className="size-[18px]" />
                    {th('btnDeposit')}
                  </>
                ),
              },
              {
                key: 'withdraw',
                href: '/wallet?tab=withdraw',
                label: (
                  <>
                    <NavIcon name="withdraw" className="size-[18px]" />
                    {th('btnWithdraw')}
                  </>
                ),
              },
            ]}
          />
        </div>
        <div className="order-1 min-w-0 xl:order-2">{balanceCard}</div>
      </div>

      {tab === 'deposit' ? (
        <DepositPanel policy={policy} address={exchangeAddress()} />
      ) : (
        <WithdrawPanel policy={policy} availableMinor={available} kycAllowance={kycAllowance} userId={user.id} />
      )}

      {/* История — один блок на всю ширину двух шагов. */}
      <OperationsHistory deposits={deposits} withdrawals={withdrawals} />
    </div>
  );
}
