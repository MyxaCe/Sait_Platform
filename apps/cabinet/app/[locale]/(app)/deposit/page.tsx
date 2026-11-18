import { redirect } from '@/i18n/navigation';

export default function LegacyDepositPage({ params }: { params: { locale: string } }) {
  redirect({ href: '/wallet?tab=deposit', locale: params.locale });
}
