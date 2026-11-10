import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ConfirmEmailForm } from '@/features/auth/AuthMailForms';

/**
 * Подтверждение email по ссылке. Подтверждает кнопка (POST), а не сам переход:
 * почтовые сканеры открывают ссылки из писем и расходовали бы одноразовый
 * токен до человека.
 */
export default async function VerifyEmailPage({ params, searchParams }: { params: { locale: string }; searchParams: { token?: string } }) {
  setRequestLocale(params.locale);
  const t = await getTranslations('authMail');
  return (
    <>
      <h1 className="text-2xl font-semibold">{t('verifyTitle')}</h1>
      <p className="mb-6 mt-1 text-sm text-secondary">{t('verifySubtitle')}</p>
      <ConfirmEmailForm token={String(searchParams.token ?? '')} />
    </>
  );
}
