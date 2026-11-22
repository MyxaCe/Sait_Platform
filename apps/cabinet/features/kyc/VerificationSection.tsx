import { getFormatter, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { EmptyState, ToneBadge, cn, type StatusTone } from '@broker/ui';
import { KYC_STEPS, listKycDocuments, type KycStep, type VerificationState } from '@/lib/kyc';
import { KycUploadForm } from './KycUploadForm';
import { SelfieCapture } from './SelfieCapture';

export const KYC_TONE: Record<VerificationState, StatusTone> = {
  unverified: 'neutral',
  pending: 'warning',
  verified: 'positive',
  rejected: 'negative',
  resubmit_requested: 'warning',
};

export function resolveKycStep(step: string | undefined, submitted: ReadonlySet<string>): KycStep {
  if ((KYC_STEPS as readonly string[]).includes(step ?? '')) return step as KycStep;
  return KYC_STEPS.find((k) => !submitted.has(k)) ?? KYC_STEPS[0];
}

const stepHref = (step: KycStep) => `/profile?tab=verification&step=${step}`;

export async function VerificationSection({
  userId,
  state,
  step,
}: {
  userId: string;
  state: VerificationState;
  step?: string;
}) {
  const t = await getTranslations('kyc');
  const format = await getFormatter();
  const documents = await listKycDocuments(userId);
  const submitted = new Set<string>(documents.map((d) => d.kind));
  const verified = state === 'verified';
  const current = resolveKycStep(step, submitted);
  const next = KYC_STEPS[KYC_STEPS.indexOf(current) + 1];

  return (
    <div className="space-y-4 xl:grid xl:grid-cols-2 xl:items-start xl:gap-5 xl:space-y-0">
      <section
        className={cn(
          'rounded-2xl border p-4 sm:p-5 xl:col-span-2',
          verified ? 'border-positive/25 bg-positive/[0.04]' : 'border-border bg-elevated',
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-semibold">{t('title')}</h2>
          <ToneBadge tone={KYC_TONE[state]}>{t(`states.${state}` as never)}</ToneBadge>
        </div>
        <p className="text-secondary mt-1 text-sm">{t(`stateText.${state}` as never)}</p>
        {!verified && state !== 'rejected' ? (
          <p className="text-secondary mt-1 text-sm">{t('reviewEta')}</p>
        ) : null}
        <ol aria-label={t('stepsLabel')} className="mt-4 grid gap-2 sm:grid-cols-3">
          {KYC_STEPS.map((kind, i) => {
            const done = verified || submitted.has(kind);
            const isCurrent = !verified && kind === current;
            return (
              <li key={kind}>
                <Link
                  href={stepHref(kind)}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors',
                    isCurrent
                      ? 'border-accent/50 bg-accent/[0.08]'
                      : 'border-border hover:bg-primary/[0.04]',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
                      done
                        ? 'bg-positive/15 text-positive'
                        : 'border-border-strong text-secondary border',
                    )}
                  >
                    {done ? (
                      <svg
                        viewBox="0 0 16 16"
                        className="size-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden
                      >
                        <path d="M3.5 8.5l3 3 6-6.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="text-primary block font-medium">
                      {t(`steps.${kind}` as never)}
                    </span>
                    <span className="text-secondary block text-xs">
                      {t(done ? 'stepDone' : 'stepTodo')}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      {!verified ? (
        <section
          className="border-border bg-elevated rounded-2xl border p-4 sm:p-5"
          data-testid={`kyc-step-${current}`}
        >
          <p className="text-secondary text-xs font-medium uppercase tracking-wide">
            {t('stepOf', { current: KYC_STEPS.indexOf(current) + 1, total: KYC_STEPS.length })}
          </p>
          <h2 className="mt-1 text-[15px] font-semibold">{t(`kinds.${current}` as never)}</h2>
          <p className="text-secondary mt-1 text-xs">{t(`stepHint.${current}` as never)}</p>
          <div className="mt-4">
            {current === 'selfie_liveness' ? (
              <SelfieCapture />
            ) : (
              <KycUploadForm key={current} kind={current} />
            )}
          </div>
          {next ? (
            <Link
              href={stepHref(next)}
              className="text-accent mt-4 inline-block text-sm font-medium hover:underline"
            >
              {t('nextStep', { step: t(`steps.${next}` as never) })} →
            </Link>
          ) : null}
        </section>
      ) : null}

      <div className="space-y-4">
        {!verified ? (
          <section className="border-border bg-elevated rounded-2xl border p-4 sm:p-5">
            <h2 className="text-[15px] font-semibold">{t('extraTitle')}</h2>
            <p className="text-secondary mt-1 text-xs">{t('extraHint')}</p>
            <div className="mt-4">
              <KycUploadForm kind="source_of_funds" />
            </div>
          </section>
        ) : null}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">{t('submittedTitle')}</h2>
          {documents.length === 0 ? (
            <div className="border-border bg-elevated rounded-2xl border">
              <EmptyState size="compact" title={t('empty')} description={t('emptyHint')} />
            </div>
          ) : (
            <ul className="divide-border border-border bg-elevated divide-y rounded-2xl border">
              {documents.map((doc) => (
                <li key={doc.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{t(`kinds.${doc.kind}` as never)}</p>
                    <p className="text-secondary text-xs">
                      {format.dateTime(doc.submittedAt, { dateStyle: 'short', timeStyle: 'short' })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
