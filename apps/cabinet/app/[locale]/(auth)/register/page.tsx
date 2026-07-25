import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { RegisterForm } from '@/features/auth/RegisterForm';

export default async function RegisterPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const t = await getTranslations('auth');

  return (
    <>
      <h1 className="text-2xl font-semibold">{t('registerTitle')}</h1>
      <p className="mb-6 mt-1 text-sm text-secondary">{t('registerSubtitle')}</p>
      <RegisterForm />
      <p className="mt-6 text-center text-sm text-secondary">
        {t('haveAccount')}{' '}
        <Link href="/login" className="text-accent hover:underline">
          {t('toLogin')}
        </Link>
      </p>
    </>
  );
}
