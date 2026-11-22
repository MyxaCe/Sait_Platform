import { redirect } from '@/i18n/redirect';

export default async function LegacyWithdrawPage({ params }: { params: { locale: string } }) {
  await redirect({ href: '/wallet?tab=withdraw', locale: params.locale });
}
