import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ForgotPasswordForm } from '@/features/auth/AuthMailForms';

/** «Забыли пароль?» — ответ один и тот же для любого email (не оракул существования). */
export default async function ForgotPasswordPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const t = await getTranslations('authMail');
  return (
    <>
      <h1 className="text-2xl font-semibold">{t('forgotTitle')}</h1>
      <p className="mb-6 mt-1 text-sm text-secondary">{t('forgotSubtitle')}</p>
      <ForgotPasswordForm />
      <p className="mt-6 text-center text-sm text-secondary">
        <Link href="/login" className="text-accent hover:underline">
          {t('backToLogin')}
        </Link>
      </p>
    </>
  );
}
