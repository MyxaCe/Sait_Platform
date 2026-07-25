import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { LoginForm } from '@/features/auth/LoginForm';

export default async function LoginPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const t = await getTranslations('auth');

  return (
    <>
      <h1 className="text-2xl font-semibold">{t('loginTitle')}</h1>
      <p className="mb-6 mt-1 text-sm text-secondary">{t('loginSubtitle')}</p>
      <LoginForm />
      <p className="mt-6 text-center text-sm text-secondary">
        {t('noAccount')}{' '}
        <Link href="/register" className="text-accent hover:underline">
          {t('toRegister')}
        </Link>
      </p>
    </>
  );
}
