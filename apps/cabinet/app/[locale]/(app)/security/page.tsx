import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { getSessionUser, listSessions } from '@/lib/auth/session';
import { revokeSessionAction } from '@/lib/actions';
import { PasswordForm } from '@/features/security/PasswordForm';

export default async function SecurityPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const user = (await getSessionUser())!;
  const t = await getTranslations('security');
  const format = await getFormatter();
  const sessions = await listSessions(user.id);

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>

      <section className="mt-6 rounded-2xl border border-border bg-elevated p-5">
        <h2 className="font-semibold">{t('changePassword')}</h2>
        <div className="mt-4">
          <PasswordForm />
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-border bg-elevated p-5">
        <h2 className="font-semibold">{t('sessions')}</h2>
        <p className="mt-1 text-xs text-secondary">{t('sessionsHint')}</p>
        <ul className="mt-4 flex flex-col gap-3">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
              <div className="min-w-0">
                <p className="truncate text-sm">
                  {t('sessionCreated', {
                    date: format.dateTime(session.createdAt, { dateStyle: 'medium', timeStyle: 'short' }),
                  })}
                  {session.ip ? ` · ${session.ip}` : ''}
                </p>
                <p className="truncate text-xs text-secondary">{session.userAgent ?? '—'}</p>
              </div>
              {session.current ? (
                <span className="shrink-0 rounded-full bg-positive/15 px-2.5 py-1 text-xs text-positive">
                  {t('sessionCurrent')}
                </span>
              ) : (
                <form action={revokeSessionAction}>
                  <input type="hidden" name="sessionId" value={session.id} />
                  <button type="submit" className="shrink-0 text-sm text-secondary hover:text-negative">
                    {t('sessionRevoke')}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
