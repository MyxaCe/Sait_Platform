import { redirect } from '@/i18n/navigation';

/** r2: вывод — вкладка «Кошелька». Старая ссылка ведёт на новое место. */
export default function LegacyWithdrawPage({ params }: { params: { locale: string } }) {
  redirect({ href: '/wallet?tab=withdraw', locale: params.locale });
}
