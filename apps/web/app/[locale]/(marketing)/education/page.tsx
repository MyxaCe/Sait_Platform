import { redirect } from '@/i18n/navigation';

export default function EducationIndexPage({ params }: { params: { locale: string } }) {
  redirect({ href: '/education/articles', locale: params.locale });
}
