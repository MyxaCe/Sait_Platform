import { redirect } from '@/i18n/navigation';

export default function LegacyWithdrawPage({ params }: { params: { locale: string } }) {
  redirect({ href: '/wallet?tab=withdraw', locale: params.locale });
}
