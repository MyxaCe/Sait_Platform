import { redirect } from '@/i18n/redirect';

/** r2: документы — вкладка «Профиля». Старая ссылка ведёт на новое место. */
export default async function LegacyDocumentsPage({ params }: { params: { locale: string } }) {
  await redirect({ href: '/profile?tab=documents', locale: params.locale });
}
