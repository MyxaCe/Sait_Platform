import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { cn } from '@broker/ui';
import { requireSessionUser } from '@/lib/auth/require';
import { getVerificationState, listKycDocuments, type VerificationState } from '@/lib/kyc';
import { KycUploadForm } from '@/features/kyc/KycUploadForm';

/**
 * Страница верификации клиента (CAB-KYC): подать KYC-документ и видеть текущее
 * состояние проверки. Документы уходят в объектное хранилище, а не на локальный
 * диск, — это настоящий поток KYC (в отличие от страницы «Документы»).
 */
const STATE_STYLE: Record<VerificationState, string> = {
  unverified: 'bg-secondary/15 text-secondary',
  pending: 'bg-accent/15 text-accent',
  verified: 'bg-positive/15 text-positive',
  rejected: 'bg-negative/15 text-negative',
};

export default async function VerificationPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const user = await requireSessionUser(params.locale);
  const t = await getTranslations('kyc');
  const format = await getFormatter();
  const [documents, state] = await Promise.all([
    listKycDocuments(user.id),
    getVerificationState(user.id),
  ]);
  const shownState: VerificationState = state ?? 'unverified';

  return (
    <div className="mx-auto max-w-xl">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <span className={cn('rounded-full px-2.5 py-1 text-xs', STATE_STYLE[shownState])}>
          {t(`states.${shownState}` as never)}
        </span>
      </div>
      <p className="mt-1 text-sm text-secondary">{t('hint')}</p>

      <section className="mt-6 rounded-2xl border border-border bg-elevated p-5">
        <h2 className="font-semibold">{t('submit')}</h2>
        <div className="mt-4">
          <KycUploadForm />
        </div>
      </section>

      <section className="mt-4">
        {documents.length === 0 ? (
          <p className="text-sm text-secondary">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-elevated p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{t(`kinds.${doc.kind}` as never)}</p>
                  <p className="text-xs text-secondary">
                    {doc.contentType ? `${doc.contentType} · ` : ''}
                    {format.dateTime(doc.submittedAt, { dateStyle: 'medium', timeStyle: 'short' })}
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
