import { redirect } from '@/i18n/navigation';

export default function LegacyVerificationPage({ params }: { params: { locale: string } }) {
  redirect({ href: '/profile?tab=verification', locale: params.locale });
}
