import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge, Button } from '@broker/ui';
import { formatDate, formatTime } from '@broker/utils';
import { Link } from '@/i18n/navigation';
import { getWebinars, type Webinar } from '@/features/education/webinars-data';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'education' });
  return { title: t('webinarsMetaTitle'), description: t('webinarsMetaDescription') };
}

// Расписание пересчитывается раз в час
export const revalidate = 3600;

interface CardLabels {
  live: string;
  record: string;
  meta: (time: string, duration: number) => string;
  date: (iso: string) => string;
  seat: string;
  recordSoon: string;
}

function WebinarCard({ webinar, labels }: { webinar: Webinar; labels: CardLabels }) {
  return (
    <article className="flex flex-col rounded-2xl border border-border bg-card p-6 lg:p-8">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={webinar.isPast ? 'neutral' : 'accent'} className="px-3 py-1 text-xs">
          {webinar.isPast ? labels.record : labels.live}
        </Badge>
        <span className="text-secondary">
          {labels.date(webinar.datetime)} ·{' '}
          {labels.meta(formatTime(webinar.datetime), webinar.durationMinutes)}
        </span>
      </div>

      <h2 className="mt-4 text-lg font-semibold leading-snug text-primary">{webinar.title}</h2>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-secondary">{webinar.description}</p>

      <div className="mt-5 flex items-center gap-3 border-t border-border pt-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-royal/40 text-sm font-semibold text-primary">
          {webinar.speaker
            .split(' ')
            .map((w) => w[0])
            .join('')}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-primary">{webinar.speaker}</p>
          <p className="truncate text-xs text-secondary">{webinar.speakerRole}</p>
        </div>
        <span className="hidden text-xs text-secondary sm:block">{webinar.level}</span>
      </div>

      <div className="mt-5">
        {webinar.isPast ? (
          <Button variant="secondary" className="w-full" disabled>
            {labels.recordSoon}
          </Button>
        ) : (
          <Link href="/register" className="block">
            <Button className="w-full" tabIndex={-1}>
              {labels.seat}
            </Button>
          </Link>
        )}
      </div>
    </article>
  );
}

export default async function WebinarsPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('education');
  const intlLocale = params.locale === 'en' ? 'en-US' : 'ru-RU';

  const webinars = getWebinars(new Date(), params.locale);
  const upcoming = webinars.filter((w) => !w.isPast);
  const past = webinars.filter((w) => w.isPast).reverse();

  const labels: CardLabels = {
    live: t('liveBadge'),
    record: t('recordBadge'),
    meta: (time, duration) => t('webinarMeta', { time, duration }),
    date: (iso) => formatDate(iso, intlLocale),
    seat: t('seat'),
    recordSoon: t('recordSoon'),
  };

  return (
    <div className="space-y-12">
      <section aria-label={t('upcoming')}>
        <h2 className="text-xl font-semibold text-primary">{t('upcoming')}</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3 lg:gap-6">
          {upcoming.map((w) => (
            <WebinarCard key={w.id} webinar={w} labels={labels} />
          ))}
        </div>
      </section>

      {past.length > 0 && (
        <section aria-label={t('past')}>
          <h2 className="text-xl font-semibold text-primary">{t('past')}</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3 lg:gap-6">
            {past.map((w) => (
              <WebinarCard key={w.id} webinar={w} labels={labels} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
