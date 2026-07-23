import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GlossaryList } from '@/features/education/GlossaryList';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'education' });
  return { title: t('glossaryMetaTitle'), description: t('glossaryMetaDescription') };
}

export default function GlossaryPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  return <GlossaryList />;
}
