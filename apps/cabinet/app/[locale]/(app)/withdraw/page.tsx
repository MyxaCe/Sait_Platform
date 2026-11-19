import { redirect } from '@/i18n/redirect';

/** r2: вывод — вкладка «Кошелька». Старая ссылка ведёт на новое место. */
export default async function LegacyWithdrawPage({ params }: { params: { locale: string } }) {
  await redirect({ href: '/wallet?tab=withdraw', locale: params.locale });
}
