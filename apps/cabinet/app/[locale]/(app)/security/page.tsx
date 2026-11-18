import { redirect } from '@/i18n/navigation';

export default function LegacySecurityPage({ params }: { params: { locale: string } }) {
  redirect({ href: '/profile?tab=security', locale: params.locale });
}
