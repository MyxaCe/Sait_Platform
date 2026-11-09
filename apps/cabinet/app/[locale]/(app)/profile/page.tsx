import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { requireSessionUser } from '@/lib/auth/require';
import { ProfileForm } from '@/features/profile/ProfileForm';

export default async function ProfilePage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const user = await requireSessionUser(params.locale);
  const t = await getTranslations('profile');
  const format = await getFormatter();

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="mt-1 text-sm text-secondary">
        {t('memberSince', { date: format.dateTime(user.createdAt, { dateStyle: 'long' }) })}
      </p>
      <div className="mt-6 rounded-2xl border border-border bg-elevated p-5">
        <ProfileForm fullName={user.fullName} email={user.email} locale={user.locale} />
      </div>
    </div>
  );
}
