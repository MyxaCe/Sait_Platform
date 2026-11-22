import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { RegisterForm } from '@/features/auth/RegisterForm';
import { registerSubtitle } from '@/lib/register-copy';
import { getTenantStartBalance } from '@/lib/tenant';
import { loadRegisterPlans } from '@/lib/register-plans';
import { InviteNotice, loadInvite } from '@/features/auth/TransferInvite';
import { safeNext, withNext } from '@/lib/auth/next-path';

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
  const [startBalance, invite, plans] = await Promise.all([
    getTenantStartBalance(),
    loadInvite(searchParams?.invite),
    loadRegisterPlans(params.locale, searchParams?.accountType),
  ]);

  const choice = registerSubtitle(startBalance, params.locale);
  const subtitle =
    choice.key === 'registerSubtitleWithAmount'
      ? t(choice.key, { amount: choice.amount })
      : t(choice.key);

  return (
    <>
      <h1 className="text-2xl font-semibold">{t('registerTitle')}</h1>
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
    </>
  );
}
