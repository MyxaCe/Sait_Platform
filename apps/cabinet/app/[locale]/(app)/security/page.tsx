import { redirect } from '@/i18n/navigation';

/** r2: безопасность — вкладка «Профиля». Старая ссылка ведёт на новое место. */
export default function LegacySecurityPage({ params }: { params: { locale: string } }) {
  redirect({ href: '/profile?tab=security', locale: params.locale });
}
