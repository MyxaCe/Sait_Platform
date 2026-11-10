import { getTranslations, setRequestLocale } from 'next-intl/server';
import { inspectToken } from '@broker/support';
import { Link } from '@/i18n/navigation';
import { ResetPasswordForm } from '@/features/auth/AuthMailForms';
import { getPool } from '@/lib/db';

/**
 * Новый пароль по ссылке из письма. Токен проверяется заранее (без расхода),
 * чтобы истёкшую/использованную ссылку назвать сразу, а не после ввода пароля.
 * Расходуется токен только отправкой формы (POST).
 */
export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({ params, searchParams }: { params: { locale: string }; searchParams: { token?: string } }) {
  setRequestLocale(params.locale);
  const t = await getTranslations('authMail');
  const token = String(searchParams.token ?? '');
  const check = await inspectToken(getPool(), 'password_reset', token).catch(() => ({ ok: false as const, reason: 'invalidToken' as const }));
  return (
    <>
      <h1 className="text-2xl font-semibold">{t('resetTitle')}</h1>
      {check.ok ? (
        <>
          <p className="mb-6 mt-1 text-sm text-secondary">{t('resetSubtitle')}</p>
          <ResetPasswordForm token={token} />
        </>
      ) : (
        <div className="mt-4 space-y-4">
          <p role="alert" className="rounded-xl border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
            {t(`token.${check.reason}`)}
          </p>
          <Link href="/forgot-password" className="text-sm text-accent hover:underline">
            {t('requestNew')} →
          </Link>
        </div>
      )}
    </>
  );
}
