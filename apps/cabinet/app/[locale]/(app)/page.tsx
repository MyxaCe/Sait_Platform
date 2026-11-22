import { setRequestLocale } from 'next-intl/server';
import type { CabinetHomeModule } from '@broker/api-client';
import { BalanceModule } from '@/features/home/BalanceModule';
import { MarketsModule } from '@/features/home/MarketsModule';
import { OnboardingModule } from '@/features/home/OnboardingModule';
import { ProfileModule } from '@/features/home/ProfileModule';
import { PromotionsModule } from '@/features/home/PromotionsModule';
import { requireSessionUser } from '@/lib/auth/require';
import { getDemoAccount } from '@/lib/data';
import { getHomeModules, getMarketInstruments, getVerificationStatus } from '@/lib/home';
import { loadClientPromotions, loadMyReferral } from '@/lib/promo';
import { getAccountHistory } from '@/lib/history';
import { listMyDeposits, listMyWithdrawals } from '@/lib/money';
import { RecentActivity } from '@/features/home/RecentActivity';
import { ReferralMini } from '@/features/home/ReferralMini';
import { GRID, PAGE } from '@/features/ui/page';
import { cn } from '@broker/ui';
import { getTenantStartBalance } from '@/lib/tenant';
import type { RealAccountBlock } from '@/features/home/BalanceModule';
import { exchangeAddress, getMoneyPolicy, getRealAccount, terminalReader } from '@/lib/money';

async function loadRealBlock(userId: string, locale: string): Promise<RealAccountBlock> {
  const [account, policy, live] = await Promise.all([
    getRealAccount(userId),
    getMoneyPolicy(userId),
    terminalReader()
      .accounts(userId)
      .catch(() => ({ state: 'unavailable' as const })),
  ]);
  const acc = live.state === 'ok' ? live.accounts.find((a) => a.kind === 'real') : undefined;
  const demo = live.state === 'ok' ? live.accounts.find((a) => a.kind === 'demo') : undefined;
  const figures = (a: typeof acc) =>
    a && a.opened ? { equityMinor: a.equityMinor, freeMarginMinor: a.freeMarginMinor, leverage: a.leverage } : null;
  return {
    account,
    policy,
    live: figures(acc),
    terminalOk: live.state === 'ok',
    demoLive: figures(demo),
    depositAddressReady: exchangeAddress() !== null,
    locale,
  };
}

export default async function HomePage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const user = await requireSessionUser(params.locale);
  const modules = await getHomeModules(params.locale);

  const needs = (type: CabinetHomeModule['type']) =>
    modules.some((m) => m.type === type && m.enabled);

  const [demo, verification, markets, promos, startBalance, realForSteps] = await Promise.all([
    needs('balance') ? getDemoAccount(user.id) : null,
    getVerificationStatus(user.id),
    needs('markets') ? getMarketInstruments() : null,
    needs('promotions') ? loadClientPromotions(user.id, params.locale) : null,
    getTenantStartBalance(),
    needs('onboarding') ? getRealAccount(user.id) : null,
  ]);

  const real: RealAccountBlock | undefined = needs('balance')
    ? await loadRealBlock(user.id, params.locale)
    : undefined;

  const [recent, deposits, withdrawals, referral] = await Promise.all([
    getAccountHistory(user.id, 'real', '30d').catch(() => null),
    listMyDeposits(user.id),
    listMyWithdrawals(user.id),
    loadMyReferral(user.id, params.locale),
  ]);

  const mod = <T extends CabinetHomeModule['type']>(type: T) =>
    modules.find((m): m is Extract<CabinetHomeModule, { type: T }> => m.type === type && m.enabled);
  const profileM = mod('profile');
  const onboardingM = mod('onboarding');
  const balanceM = mod('balance');
  const marketsM = mod('markets');
  const promotionsM = mod('promotions');

  return (
    <div className={cn(PAGE, 'flex flex-col gap-4 lg:gap-5')}>
      {profileM ? <ProfileModule user={user} verification={verification} /> : null}

      <div className={GRID}>
        {onboardingM ? (
          <div className={cn('xl:col-span-12', balanceM && '2xl:col-span-4 2xl:col-start-9 2xl:row-start-1')}>
            <OnboardingModule
              config={onboardingM}
              verification={verification}
              realFunded={(realForSteps?.balanceCents ?? 0) > 0}
              column={Boolean(balanceM)}
            />
          </div>
        ) : null}
        {balanceM ? (
          <div className={cn('xl:col-span-12', onboardingM && '2xl:col-span-8 2xl:col-start-1 2xl:row-start-1')}>
            <BalanceModule config={balanceM} demo={demo} startBalance={startBalance} real={real} />
          </div>
        ) : null}
      </div>

      <div className={GRID}>
        {marketsM && markets ? (
          <div className="xl:col-span-6 2xl:col-span-5 xl:[&>section]:h-full">
            <MarketsModule config={marketsM} data={markets} />
          </div>
        ) : null}
        <div className="hidden xl:col-span-6 xl:block 2xl:col-span-4">
          <RecentActivity
            trades={recent?.trades ?? []}
            deposits={deposits}
            withdrawals={withdrawals}
            currency={recent?.currency ?? 'USDT'}
          />
        </div>
        <div className="flex flex-col gap-4 xl:col-span-12 xl:grid xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] xl:gap-5 2xl:col-span-3 2xl:flex 2xl:flex-col">
          {promotionsM ? (
            <PromotionsModule view={promos?.state === 'ok' ? promos.data : null} compact />
          ) : null}
          <div className="hidden xl:block">
            <ReferralMini referral={referral.state === 'ok' ? referral.data.referral : null} />
          </div>
        </div>
      </div>
    </div>
  );
}
