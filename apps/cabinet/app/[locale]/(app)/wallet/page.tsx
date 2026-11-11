import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Callout, Money, cn } from '@broker/ui';
import { requireSessionUser } from '@/lib/auth/require';
import {
  exchangeAddress,
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
import { PAGE_NARROW } from '@/features/ui/page';
// ── Перевод на другую платформу группы (ветка client-transfer) ──
import { TransferNotice } from '@/features/transfer/TransferNotice';

/**
 * «Кошелёк» (r2, замечание владельца): пополнение и вывод — одна страница.
 *
 *   сверху  — баланс реального счёта и «доступно к выводу» (свободная маржа);
 *   затем   — переключатель «Пополнить | Вывести» (`?tab=`, работает без JS);
 *   внизу   — общая история операций (ввод и вывод одной лентой).
 *
 * По умолчанию — «Пополнить»: это первое действие нового клиента. Старые
 * `/deposit` и `/withdraw` ведут сюда на нужную вкладку.
 */
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
  // Доступно = свободная маржа (не больше баланса); терминал молчит — баланс.
  const available = freeMargin !== null ? Math.max(0, Math.min(freeMargin, balance)) : balance;
  const currency = realMoneyCurrency(account?.currency);

  const balanceCard = (
    <section
      className="rounded-2xl border border-accent/40 bg-elevated p-4 sm:p-5"
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
      <p className="mt-2 text-xs text-secondary">
        {freeMargin !== null ? t('availableHint') : t('availableFallbackHint')}
      </p>
    </section>
  );

  /*
   * Раскладка (десктоп, 10.11). Телефон и < xl — прежняя колонка.
   * ≥ xl: слева действие (переключатель + форма), справа колонка «счёт +
   * история операций» (липкая). ≥ 2xl: форма | инструкция/QR | история —
   * форма и инструкция делят левую часть (см. DepositPanel/WithdrawPanel).
   * Баланс и история на десктопе выведены в правую колонку отдельной копией
   * (только чтение): так порядок на телефоне не меняется.
   */
  return (
    <div className={cn(PAGE_NARROW, 'xl:grid xl:grid-cols-12 xl:items-start xl:gap-5')}>
      <div className="space-y-4 sm:space-y-5 xl:col-span-7 2xl:col-span-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t('walletTitle')}</h1>
          <p className="mt-1 text-sm text-secondary">{t('walletLead')}</p>
        </div>
        <TransferNotice userId={user.id} withWithdrawLink={tab !== 'withdraw'} />

        <div className="xl:hidden">{balanceCard}</div>

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

        {tab === 'deposit' ? (
          <DepositPanel policy={policy} address={exchangeAddress()} />
        ) : (
          <WithdrawPanel policy={policy} availableMinor={available} />
        )}

        <div className="xl:hidden">
          <OperationsHistory deposits={deposits} withdrawals={withdrawals} />
        </div>
      </div>

      <aside className="hidden space-y-5 xl:sticky xl:top-6 xl:col-span-5 xl:block 2xl:col-span-4">
        {balanceCard}
        <OperationsHistory deposits={deposits} withdrawals={withdrawals} titleId="ops-title-desk" />
      </aside>
    </div>
  );
}
