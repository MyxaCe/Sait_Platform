import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { cn } from '@broker/ui';
import { CabinetTicker } from '@/features/shell/CabinetTicker';
import { getSessionUser } from '@/lib/auth/session';
import { getApplicationStatus, getDemoAccount } from '@/lib/data';

export default async function DashboardPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const user = (await getSessionUser())!;
  const t = await getTranslations('dashboard');
  const format = await getFormatter();

  const [application, demo] = await Promise.all([
    getApplicationStatus(user.email),
    getDemoAccount(user.id),
  ]);

  const steps = application
    ? [
        { label: t('stepSubmitted'), done: true },
        { label: t('stepDispatched'), done: application.dispatchedAt !== null },
        { label: t('stepReview'), done: false, hint: t('stepReviewHint') },
      ]
    : [];

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold">
        {t('greeting', { name: user.fullName.split(' ')[0] ?? user.fullName })}
      </h1>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {/* Статус заявки */}
        <section className="rounded-2xl border border-border bg-elevated p-5">
          <h2 className="font-semibold">{t('application')}</h2>
          {application ? (
            <ol className="mt-4 flex flex-col gap-3">
              {steps.map((step, i) => (
                <li key={step.label} className="flex items-start gap-3">
                  <span
                    className={cn(
                      'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold',
                      step.done ? 'bg-positive text-base' : 'border border-border text-secondary',
                    )}
                  >
                    {step.done ? '✓' : i + 1}
                  </span>
                  <div>
                    <p className={cn('text-sm', step.done ? 'text-primary' : 'text-secondary')}>
                      {step.label}
                    </p>
                    {step.hint && !step.done && (
                      <p className="text-xs text-secondary/80">{step.hint}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-secondary">{t('applicationNone')}</p>
          )}
        </section>

        {/* Демо-счёт */}
        <section className="rounded-2xl border border-border bg-elevated p-5">
          <h2 className="font-semibold">{t('demoTitle')}</h2>
          {demo && (
            <>
              <p className="mt-3 text-3xl font-bold text-accent">
                {format.number(demo.balanceCents / 100, {
                  style: 'currency',
                  currency: demo.currency,
                  maximumFractionDigits: 2,
                })}
              </p>
              <p className="mt-1 text-xs text-secondary">
                {t('openedAt', { date: format.dateTime(demo.createdAt, { dateStyle: 'long' }) })}
              </p>
            </>
          )}
          <p className="mt-3 text-sm text-secondary">{t('demoHint')}</p>
        </section>
      </div>

      {/* Рынки */}
      <section className="mt-4 overflow-hidden rounded-2xl border border-border bg-elevated">
        <h2 className="px-5 pt-4 font-semibold">{t('marketsTitle')}</h2>
        <div className="mt-3">
          <CabinetTicker />
        </div>
      </section>

      {/* Быстрые действия */}
      <section className="mt-4 rounded-2xl border border-border bg-elevated p-5">
        <h2 className="font-semibold">{t('quickTitle')}</h2>
        <div className="mt-3 flex flex-col gap-2 text-sm">
          <Link href="/documents" className="text-accent hover:underline">→ {t('quickDocs')}</Link>
          <Link href="/profile" className="text-accent hover:underline">→ {t('quickProfile')}</Link>
          <Link href="/security" className="text-accent hover:underline">→ {t('quickSecurity')}</Link>
        </div>
      </section>
    </div>
  );
}
