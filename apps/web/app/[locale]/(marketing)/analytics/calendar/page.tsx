import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { EconomicCalendar } from '@/features/analytics/EconomicCalendar';
import { loadCalendar, MAX_WEEK_OFFSET, parseWeekOffset, utcWeek } from '@/lib/economic-calendar';
import { intlTag, pageLocale } from '@/lib/locale';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { locale: string };
  searchParams?: Record<string, string | string[] | undefined>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'analytics' });
  return {
    title: t('calendarMetaTitle'),
    description: t('calendarMetaDescription'),
    robots: { index: false, follow: true },
  };
}

function Notice({ testId, title, text }: { testId: string; title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-8 text-center" data-testid={testId}>
      <p className="font-medium text-primary">{title}</p>
      <p className="mt-2 text-sm text-secondary">{text}</p>
    </div>
  );
}

function weekHref(offset: number): string {
  return offset === 0 ? '/analytics/calendar' : `/analytics/calendar?week=${offset}`;
}

const navLink =
  'inline-flex min-h-[40px] items-center rounded-full border border-border bg-card px-4 text-sm text-secondary hover:text-primary';

export default async function CalendarPage({ params, searchParams }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('analytics.calendar');
  const lang = pageLocale(params.locale);
  const offset = parseWeekOffset(searchParams?.week);
  const week = utcWeek(new Date(), offset);
  const result = await loadCalendar({ ...week, lang });

  if (result.state === 'not-configured') {
    return <Notice testId="calendar-no-source" title={t('noSourceTitle')} text={t('noSourceText')} />;
  }

  const period = new Intl.DateTimeFormat(intlTag(lang), {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatRange(new Date(`${week.from}T00:00:00Z`), new Date(`${week.to}T00:00:00Z`));
  const foreignTitles =
    result.state === 'ok' && result.data.lang && result.data.lang !== lang ? result.data.lang : undefined;

  return (
    <div data-testid="calendar">
      <nav aria-label={t('weekNavLabel')} className="mb-6 flex flex-wrap items-center gap-3">
        {offset > -MAX_WEEK_OFFSET && (
          <Link href={weekHref(offset - 1)} className={navLink} rel="nofollow">
            ← {t('weekPrev')}
          </Link>
        )}
        <p className="order-first w-full text-sm font-medium text-primary sm:order-none sm:w-auto" data-testid="calendar-period">
          {period}
          <span className="ml-2 font-normal text-secondary">{t('periodUtc')}</span>
        </p>
        {offset < MAX_WEEK_OFFSET && (
          <Link href={weekHref(offset + 1)} className={navLink} rel="nofollow">
            {t('weekNext')} →
          </Link>
        )}
        {offset !== 0 && (
          <Link href={weekHref(0)} className={navLink}>
            {t('weekCurrent')}
          </Link>
        )}
      </nav>

      {result.state === 'unavailable' ? (
        <Notice testId="calendar-unavailable" title={t('unavailableTitle')} text={t('unavailableText')} />
      ) : (
        <>
          {result.stale && (
            <p className="mb-4 text-sm text-secondary" data-testid="calendar-stale">
              {t('staleNote', {
                time: new Intl.DateTimeFormat(intlTag(lang), {
                  timeZone: 'UTC',
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(new Date(result.fetchedAt)),
              })}
            </p>
          )}
          {result.data.events.length === 0 ? (
            result.data.complete ? (
              <Notice testId="calendar-empty" title={t('emptyTitle')} text={t('emptyText')} />
            ) : (
              <Notice testId="calendar-incomplete" title={t('incompleteTitle')} text={t('incompleteText')} />
            )
          ) : (
            <>
              {!result.data.complete && (
                <p className="mb-4 text-sm text-secondary" data-testid="calendar-partial">
                  {t('partialNote')}
                </p>
              )}
              {foreignTitles && (
                <p className="mb-4 text-sm text-secondary" data-testid="calendar-title-lang">
                  {t('titlesLangNote')}
                </p>
              )}
              <EconomicCalendar events={result.data.events} titleLang={foreignTitles} />
            </>
          )}
          {result.data.source && (
            <p className="mt-8 text-xs text-secondary" data-testid="calendar-source">
              {t('sourceLabel', { source: result.data.source })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
