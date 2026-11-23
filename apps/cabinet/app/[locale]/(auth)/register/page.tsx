import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { RegisterForm } from '@/features/auth/RegisterForm';
import { registerSubtitle } from '@/lib/register-copy';
import { getTenantStartBalance } from '@/lib/tenant';
import { loadRegisterPlans } from '@/lib/register-plans';
import { InviteNotice, loadInvite } from '@/features/auth/TransferInvite';
import { safeNext, withNext } from '@/lib/auth/next-path';
import { HelpButton } from '@/features/tour/HelpButton';
import { TourProvider } from '@/features/tour/TourProvider';
import { loadTourConfig } from '@/lib/onboarding/server';
import { partOf } from '@/lib/onboarding/state';

export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams?: { invite?: string; accountType?: string; next?: string };
}) {
  setRequestLocale(params.locale);
  const t = await getTranslations('auth');
  const next = safeNext(searchParams?.next);
  const [startBalance, invite, plans, tour] = await Promise.all([
    getTenantStartBalance(),
    loadInvite(searchParams?.invite),
    loadRegisterPlans(params.locale, searchParams?.accountType),
    loadTourConfig(params.locale),
  ]);

  const choice = registerSubtitle(startBalance, params.locale);
  const subtitle =
    choice.key === 'registerSubtitleWithAmount'
      ? t(choice.key, { amount: choice.amount })
      : t(choice.key);

  return (
    <TourProvider part={partOf(tour, 'registration') ?? null} labels={tour?.labels ?? null} autostart persist="local">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('registerTitle')}</h1>
        <HelpButton />
      </div>
      <p className="mb-6 mt-1 text-sm text-secondary">{subtitle}</p>
      <InviteNotice invite={invite} />
      <RegisterForm
        prefill={invite.state === 'ok' ? invite.prefill : undefined}
        plans={plans.plans}
        selectedPlan={plans.selected ?? undefined}
        next={next}
      />
      <p className="mt-6 text-center text-sm text-secondary">
        {t('haveAccount')}{' '}
        <Link href={withNext('/login', next)} className="text-accent hover:underline">
          {t('toLogin')}
        </Link>
      </p>
    </TourProvider>
  );
}
