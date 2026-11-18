import { redirect } from '@/i18n/navigation';

export default function LegacyDocumentsPage({ params }: { params: { locale: string } }) {
  redirect({ href: '/profile?tab=documents', locale: params.locale });
}
