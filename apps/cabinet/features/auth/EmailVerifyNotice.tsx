import { getTranslations } from 'next-intl/server';
import { getPool } from '@/lib/db';
import { RequestVerifyEmail } from './AuthMailForms';

/**
 * Профиль: email не подтверждён → письмо со ссылкой (почта поддержки).
 * Подтверждённый — ничего не рисуем (недоступное/ненужное не отрисовано).
 */
export async function EmailVerifyNotice({ userId }: { userId: string }) {
  const r = await getPool()
    .query(`SELECT email_verified_at FROM users WHERE id = $1`, [userId])
    .catch(() => null);
  if (!r || r.rows[0]?.email_verified_at) return null;
  const t = await getTranslations('authMail');
  return (
    <section className="rounded-2xl border border-warning/30 bg-warning/[0.06] p-4 sm:p-5">
      <h2 className="font-semibold">{t('verifyNoticeTitle')}</h2>
      <p className="mb-3 mt-1 text-sm text-secondary">{t('verifyNoticeText')}</p>
      <RequestVerifyEmail />
    </section>
  );
}
