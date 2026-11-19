import { redirect } from '@/i18n/redirect';

/** r2: пополнение — вкладка «Кошелька». Старая ссылка ведёт на новое место. */
export default async function LegacyDepositPage({ params }: { params: { locale: string } }) {
  await redirect({ href: '/wallet?tab=deposit', locale: params.locale });
}
