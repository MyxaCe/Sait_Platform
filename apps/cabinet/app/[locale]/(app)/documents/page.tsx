import { redirect } from '@/i18n/navigation';

/** r2: документы — вкладка «Профиля». Старая ссылка ведёт на новое место. */
export default function LegacyDocumentsPage({ params }: { params: { locale: string } }) {
  redirect({ href: '/profile?tab=documents', locale: params.locale });
}
