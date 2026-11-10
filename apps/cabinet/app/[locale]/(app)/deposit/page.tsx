import { redirect } from '@/i18n/navigation';

/** r2: пополнение — вкладка «Кошелька». Старая ссылка ведёт на новое место. */
export default function LegacyDepositPage({ params }: { params: { locale: string } }) {
  redirect({ href: '/wallet?tab=deposit', locale: params.locale });
}
