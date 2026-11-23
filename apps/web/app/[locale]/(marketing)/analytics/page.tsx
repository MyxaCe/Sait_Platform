import { redirect } from '@/i18n/redirect';
import { pageLocale } from '@/lib/locale';
import { emptySections } from '@/lib/empty-sections';

export default async function AnalyticsIndexPage({ params }: { params: { locale: string } }) {
  const empty = await emptySections(pageLocale(params.locale));
  await redirect({ href: empty.has('/analytics/news') ? '/analytics/calendar' : '/analytics/news', locale: params.locale });
}
