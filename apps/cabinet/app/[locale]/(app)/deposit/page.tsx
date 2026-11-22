import { redirect } from '@/i18n/redirect';

export default async function LegacyDepositPage({ params }: { params: { locale: string } }) {
  await redirect({ href: '/wallet?tab=deposit', locale: params.locale });
}
