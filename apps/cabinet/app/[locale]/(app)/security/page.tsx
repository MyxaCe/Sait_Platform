import { redirect } from '@/i18n/redirect';

/** r2: безопасность — вкладка «Профиля». Старая ссылка ведёт на новое место. */
export default async function LegacySecurityPage({ params }: { params: { locale: string } }) {
  await redirect({ href: '/profile?tab=security', locale: params.locale });
}
