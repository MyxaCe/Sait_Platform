import { getFormatter, getTranslations } from 'next-intl/server';
import { EmptyState, ToneBadge, cn, type StatusTone } from '@broker/ui';
import { listSessions, type SessionUser } from '@/lib/auth/session';
import { revokeSessionAction } from '@/lib/actions';
import { listDocuments } from '@/lib/data';
import { KYC_DOC_KINDS, listKycDocuments, type VerificationState } from '@/lib/kyc';
import { ProfileForm } from './ProfileForm';
import { PasswordForm } from '@/features/security/PasswordForm';
import { UploadForm } from '@/features/documents/UploadForm';
import { KycUploadForm } from '@/features/kyc/KycUploadForm';

/**
 * Разделы страницы «Профиль» (r2: профиль, верификация, безопасность и
 * документы — одна страница с вкладками). Формы и экшены — прежние.
 */

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-elevated p-4 sm:p-5">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {hint ? <p className="mt-1 text-xs text-secondary">{hint}</p> : null}
      <div className="mt-4">{children}</div>
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

const KYC_TONE: Record<VerificationState, StatusTone> = {
  unverified: 'neutral',
  pending: 'warning',
  verified: 'positive',
  rejected: 'negative',
};

export async function VerificationSection({ userId, state }: { userId: string; state: VerificationState }) {
  const t = await getTranslations('kyc');
  const format = await getFormatter();
  const documents = await listKycDocuments(userId);
  const submitted = new Set(documents.map((d) => d.kind));

  // Шаги верификации: что подано — отмечено; итог — решение оператора.
  const steps = [
    ...KYC_DOC_KINDS.slice(0, 3).map((kind) => ({
      key: kind,
      label: t(`kinds.${kind}` as never),
      done: state === 'verified' || submitted.has(kind),
    })),
    { key: 'review', label: t('stepReview'), done: state === 'verified' },
  ];

  return (
    <div className="space-y-4">
      <section
        className={cn(
          'rounded-2xl border p-4 sm:p-5',
          state === 'verified' ? 'border-positive/25 bg-positive/[0.04]' : 'border-border bg-elevated',
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-semibold">{t('title')}</h2>
          <ToneBadge tone={KYC_TONE[state]}>{t(`states.${state}` as never)}</ToneBadge>
        </div>
        <p className="mt-1 text-sm text-secondary">{t(`stateText.${state}` as never)}</p>
        <ol className="mt-4 grid gap-2 sm:grid-cols-2">
          {steps.map((s, i) => (
            <li key={s.key} className="flex items-center gap-2.5 text-sm">
              <span
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
                  s.done ? 'bg-positive/15 text-positive' : 'border border-border-strong text-secondary',
                )}
              >
                {s.done ? (
                  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M3.5 8.5l3 3 6-6.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span className={s.done ? 'text-primary' : 'text-secondary'}>{s.label}</span>
            </li>
          ))}
        </ol>
      </section>

      {state !== 'verified' ? (
        <Card title={t('submit')} hint={t('hint')}>
          <KycUploadForm />
        </Card>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('submittedTitle')}</h2>
        {documents.length === 0 ? (
          <div className="rounded-2xl border border-border bg-elevated">
            <EmptyState size="compact" title={t('empty')} description={t('emptyHint')} />
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-elevated">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm">{t(`kinds.${doc.kind}` as never)}</p>
                  <p className="text-xs text-secondary">
                    {format.dateTime(doc.submittedAt, { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export async function SecuritySection({ userId }: { userId: string }) {
  const t = await getTranslations('security');
  const format = await getFormatter();
  const sessions = await listSessions(userId);
  return (
    <div className="space-y-4">
      <Card title={t('changePassword')}>
        <PasswordForm />
      </Card>
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
    <div className="space-y-4">
      <Card title={t('upload')} hint={t('hint')}>
        <UploadForm />
      </Card>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t('title')}</h2>
        {documents.length === 0 ? (
          <div className="rounded-2xl border border-border bg-elevated">
            <EmptyState size="compact" title={t('empty')} />
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-elevated">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-3 px-4 py-3">
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
