import { redirect } from '@/i18n/navigation';

/** r2: верификация — вкладка «Профиля». Старая ссылка ведёт на новое место. */
export default function LegacyVerificationPage({ params }: { params: { locale: string } }) {
  redirect({ href: '/profile?tab=verification', locale: params.locale });
}
