import { redirect } from '@/i18n/redirect';

export default async function LegacyDocumentsPage({ params }: { params: { locale: string } }) {
  await redirect({ href: '/profile?tab=documents', locale: params.locale });
}
