import { redirect } from '@/i18n/navigation';

export default function AnalyticsIndexPage({ params }: { params: { locale: string } }) {
  redirect({ href: '/analytics/news', locale: params.locale });
}
