import { getFormatter, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { EmptyState, ToneBadge, cn, type StatusTone } from '@broker/ui';
import { listSessions, type SessionUser } from '@/lib/auth/session';
import { revokeSessionAction } from '@/lib/actions';
import { listDocuments } from '@/lib/data';
import type { VerificationState } from '@/lib/kyc';
import { KYC_TONE } from '@/features/kyc/VerificationSection';
import { ProfileForm } from './ProfileForm';
import { PasswordForm } from '@/features/security/PasswordForm';
import { TwoFactorCard } from '@/features/security/TwoFactorCard';
import { isTwoFactorEnabled } from '@broker/support';
import { twoFactorPool } from '@/lib/two-factor';
import { UploadForm } from '@/features/documents/UploadForm';

function Card({ title, hint, children, className }: { title: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={['flex min-w-0 flex-col rounded-2xl border border-border bg-elevated p-4 sm:p-5', className].filter(Boolean).join(' ')}>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {hint ? <p className="mt-1 text-xs text-secondary">{hint}</p> : null}
      <div className="mt-4 flex flex-1 flex-col">{children}</div>
    </section>
  );
}

export async function PersonalSection({ user }: { user: SessionUser }) {
  const t = await getTranslations('profile');
  return (
    <Card title={t('personalTitle')} hint={t('personalHint')}>
      <ProfileForm fullName={user.fullName} email={user.email} locale={user.locale} />
    </Card>
  );
}


export async function SecuritySection({ userId }: { userId: string }) {
  const t = await getTranslations('security');
  const format = await getFormatter();
  const [sessions, twoFactor] = await Promise.all([listSessions(userId), isTwoFactorEnabled(twoFactorPool(), userId)]);
  return (
    <div className="space-y-4 xl:grid xl:grid-cols-2 xl:items-stretch xl:gap-5 xl:space-y-0">
      <Card title={t('changePassword')}>
        <PasswordForm twoFactor={twoFactor} />
      </Card>
      <TwoFactorCard userId={userId} />
      <Card title={t('sessions')} hint={t('sessionsHint')}>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center justify-between gap-3 px-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm">
                  {t('sessionCreated', {
                    date: format.dateTime(session.createdAt, { dateStyle: 'short', timeStyle: 'short' }),
                  })}
                  {session.ip ? ` · ${session.ip}` : ''}
                </p>
                <p className="truncate text-xs text-secondary">{session.userAgent ?? '—'}</p>
              </div>
              {session.current ? (
                <ToneBadge tone="positive">{t('sessionCurrent')}</ToneBadge>
              ) : (
                <form action={revokeSessionAction}>
                  <input type="hidden" name="sessionId" value={session.id} />
                  <button
                    type="submit"
                    className="inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-sm text-secondary hover:bg-negative/10 hover:text-negative"
                  >
                    {t('sessionRevoke')}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

const DOC_TONE: Record<string, StatusTone> = { uploaded: 'warning', approved: 'positive', rejected: 'negative' };

export async function DocumentsSection({ userId }: { userId: string }) {
  const t = await getTranslations('documents');
  const format = await getFormatter();
  const documents = await listDocuments(userId);
  return (
    <div className="space-y-4 xl:grid xl:grid-cols-2 xl:items-stretch xl:gap-5 xl:space-y-0">
      <Card title={t('upload')} hint={t('hint')}>
        <UploadForm />
      </Card>
      <section className="flex min-w-0 flex-col rounded-2xl border border-border bg-elevated">
        <h2 className="px-4 pt-4 text-[15px] font-semibold sm:px-5 sm:pt-5">{t('title')}</h2>
        {documents.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState size="compact" title={t('empty')} />
          </div>
        ) : (
          <ul className="mt-3 flex-1 divide-y divide-border border-t border-border">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="truncate text-sm">{doc.filename}</p>
                  <p className="text-xs text-secondary">
                    {t(`kinds.${doc.kind}` as never)} · {(doc.sizeBytes / 1024 / 1024).toFixed(1)} MB ·{' '}
                    {format.dateTime(doc.createdAt, { dateStyle: 'short' })}
                  </p>
                </div>
                <ToneBadge tone={DOC_TONE[doc.status] ?? 'neutral'}>{t(`statuses.${doc.status}` as never)}</ToneBadge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export async function AccountOverview({ userId, state }: { userId: string; state: VerificationState }) {
  const t = await getTranslations('profile');
  const tk = await getTranslations('kyc');
  const ts = await getTranslations('security');
  const sessions = await listSessions(userId);
  return (
    <div className="flex h-full flex-col gap-5">
      <Card title={tk('title')} className="flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <ToneBadge tone={KYC_TONE[state]}>{tk(`states.${state}` as never)}</ToneBadge>
        </div>
        <p className="mt-2 text-sm text-secondary">{tk(`stateText.${state}` as never)}</p>
        <Link href="/profile?tab=verification" className="mt-auto inline-block pt-3 text-sm font-medium text-accent hover:underline">
          {t('openVerification')} →
        </Link>
      </Card>
      <Card title={ts('title')} className="flex-1">
        <p className="text-sm text-secondary">{t('sessionsActive', { n: sessions.length })}</p>
        <Link href="/profile?tab=security" className="mt-auto inline-block pt-3 text-sm font-medium text-accent hover:underline">
          {t('openSecurity')} →
        </Link>
      </Card>
    </div>
  );
}
