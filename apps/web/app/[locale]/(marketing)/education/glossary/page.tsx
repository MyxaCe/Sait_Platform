import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GlossaryList } from '@/features/education/GlossaryList';
import { getCms } from '@/lib/cms';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'education' });
  return { title: t('glossaryMetaTitle'), description: t('glossaryMetaDescription') };
}

export default async function GlossaryPage({ params }: PageProps) {
  setRequestLocale(params.locale);
  // Глоссарий из CMS (тег cms:academy)
  const { glossary } = await getCms('academy', {
    locale: params.locale === 'en' ? 'en' : 'ru',
  });
  return <GlossaryList terms={glossary} />;
}
