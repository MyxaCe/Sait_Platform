import { redirect } from '@/i18n/redirect';

export default async function AnalyticsIndexPage({ params }: { params: { locale: string } }) {
  await redirect({ href: '/analytics/news', locale: params.locale });
}
