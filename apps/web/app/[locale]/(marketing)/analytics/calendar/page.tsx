import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCalendarEvents } from '@/features/analytics/calendar-data';
import { EconomicCalendar } from '@/features/analytics/EconomicCalendar';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'analytics' });
  return { title: t('calendarMetaTitle'), description: t('calendarMetaDescription') };
}

// ISR: события пересчитываются раз в час, «Факт» у прошедших заполняется
export const revalidate = 3600;

export default function CalendarPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  const events = getCalendarEvents(new Date(), params.locale);
  return <EconomicCalendar events={events} />;
}
