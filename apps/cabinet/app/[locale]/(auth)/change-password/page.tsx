import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { ForcedPasswordForm } from '@/features/auth/AuthMailForms';
import { getSessionUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const user = await getSessionUser();
  const prefix = params.locale === 'en' ? '/en' : '';
  if (!user) redirect(`${prefix}/login`);
  if (!user.mustChangePassword) redirect(prefix || '/');
  const t = await getTranslations('authMail');
  return (
    <>
      <h1 className="text-2xl font-semibold">{t('forced.title')}</h1>
      <p className="mb-6 mt-1 text-sm text-secondary">{t('forced.subtitle')}</p>
      <ForcedPasswordForm />
    </>
  );
}
