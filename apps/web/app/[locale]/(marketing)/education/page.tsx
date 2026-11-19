import { redirect } from '@/i18n/redirect';

export default async function EducationIndexPage({ params }: { params: { locale: string } }) {
  await redirect({ href: '/education/articles', locale: params.locale });
}
