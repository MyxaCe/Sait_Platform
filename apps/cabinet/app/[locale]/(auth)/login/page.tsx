import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { LoginForm } from '@/features/auth/LoginForm';
import { safeLaunchNext } from '@/lib/sso/launch';

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams?: { next?: string; reset?: string };
}) {
  setRequestLocale(params.locale);
  const t = await getTranslations('auth');
  const tm = await getTranslations('authMail');

  return (
    <>
      <h1 className="text-2xl font-semibold">{t('loginTitle')}</h1>
      <p className="mb-6 mt-1 text-sm text-secondary">{t('loginSubtitle')}</p>
      {searchParams?.reset === '1' ? (
        <p role="status" className="mb-4 rounded-xl border border-positive/40 bg-positive/10 px-4 py-3 text-sm">
          {tm('resetDone')}
        </p>
      ) : null}
      {/* Продолжение входа в терминал (launch) — только внутренний путь. */}
      <LoginForm next={safeLaunchNext(searchParams?.next)} />
      <p className="mt-3 text-right text-sm">
        <Link href="/forgot-password" className="text-accent hover:underline">
          {tm('forgotLink')}
        </Link>
      </p>
      <p className="mt-6 text-center text-sm text-secondary">
        {t('noAccount')}{' '}
        <Link href="/register" className="text-accent hover:underline">
          {t('toRegister')}
        </Link>
      </p>
    </>
  );
}
