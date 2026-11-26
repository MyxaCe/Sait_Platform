import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ResendActivationForm } from '@/features/auth/AuthMailForms';
import { maskEmail } from '@/lib/auth/pending-activation';
import { readPendingActivation } from '@/lib/auth/pending-activation-cookie';

export const dynamic = 'force-dynamic';

/**
 * Экран после «Зарегистрироваться» (и после повторной регистрации того же адреса —
 * экран одинаковый, по нему не узнать, был ли адрес в базе). Вход в кабинет — только по
 * ссылке из письма.
 */
export default async function CheckEmailPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const t = await getTranslations('authMail');
  const pending = readPendingActivation();
  return (
    <div className="space-y-5" data-testid="check-email">
      <div>
        <h1 className="text-2xl font-semibold">{t('checkEmailTitle')}</h1>
        <p className="mt-2 text-sm text-secondary">
          {pending ? t('checkEmailText', { email: maskEmail(pending.email) }) : t('checkEmailTextNoEmail')}
        </p>
      </div>
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-secondary">
        <li>{t('checkEmailSpam')}</li>
        <li>{t('checkEmailExisting')}</li>
      </ul>
      {pending ? <ResendActivationForm /> : null}
      <div className="flex flex-wrap justify-between gap-3 text-sm">
        <Link href="/login" className="text-accent hover:underline">
          {t('toLogin')}
        </Link>
        <Link href="/forgot-password" className="text-accent hover:underline">
          {t('forgotLink')}
        </Link>
      </div>
    </div>
  );
}
