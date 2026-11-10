import { setRequestLocale } from 'next-intl/server';
import { Advantages } from '@/components/home/Advantages';
import { CtaBand } from '@/components/home/CtaBand';
import { DownloadApp } from '@/components/home/DownloadApp';
import { Hero } from '@/components/home/Hero';
import { getCms } from '@/lib/cms';

export default async function HomePage({ params }: { params: { locale: string } }) {
  // Обязательно для статического рендеринга: Hero/Advantages используют переводы на сервере
  setRequestLocale(params.locale);
  const brand = await getCms('brand', { locale: params.locale === 'en' ? 'en' : 'ru' });

  return (
    <>
      <Hero />
      <Advantages />
      <DownloadApp brandName={brand.name} />
      <CtaBand />
    </>
  );
}
