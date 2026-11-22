import { redirect } from '@/i18n/redirect';

export default async function LegacyVerificationPage({ params }: { params: { locale: string } }) {
  await redirect({ href: '/profile?tab=verification', locale: params.locale });
}
