import { redirect } from '@/i18n/redirect';

export default async function LegacySecurityPage({ params }: { params: { locale: string } }) {
  await redirect({ href: '/profile?tab=security', locale: params.locale });
}
