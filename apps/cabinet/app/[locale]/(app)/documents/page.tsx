import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { cn } from '@broker/ui';
import { getSessionUser } from '@/lib/auth/session';
import { listDocuments } from '@/lib/data';
import { UploadForm } from '@/features/documents/UploadForm';

const STATUS_STYLE: Record<string, string> = {
  uploaded: 'bg-accent/15 text-accent',
  approved: 'bg-positive/15 text-positive',
  rejected: 'bg-negative/15 text-negative',
};

export default async function DocumentsPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const user = (await getSessionUser())!;
  const t = await getTranslations('documents');
  const format = await getFormatter();
  const documents = await listDocuments(user.id);

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="mt-1 text-sm text-secondary">{t('hint')}</p>

      <section className="mt-6 rounded-2xl border border-border bg-elevated p-5">
        <h2 className="font-semibold">{t('upload')}</h2>
        <div className="mt-4">
          <UploadForm />
        </div>
      </section>

      <section className="mt-4">
        {documents.length === 0 ? (
          <p className="text-sm text-secondary">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-elevated p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm">{doc.filename}</p>
                  <p className="text-xs text-secondary">
                    {t(`kinds.${doc.kind}` as never)} · {(doc.sizeBytes / 1024 / 1024).toFixed(1)} MB ·{' '}
                    {format.dateTime(doc.createdAt, { dateStyle: 'medium' })}
                  </p>
                </div>
                <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs', STATUS_STYLE[doc.status])}>
                  {t(`statuses.${doc.status}` as never)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
