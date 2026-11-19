import { redirect } from '@/i18n/redirect';

/** r2: верификация — вкладка «Профиля». Старая ссылка ведёт на новое место. */
export default async function LegacyVerificationPage({ params }: { params: { locale: string } }) {
  await redirect({ href: '/profile?tab=verification', locale: params.locale });
}
