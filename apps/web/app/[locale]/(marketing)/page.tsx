import { setRequestLocale } from 'next-intl/server';
import { Advantages } from '@/components/home/Advantages';
import { CtaBand } from '@/components/home/CtaBand';
import { DownloadApp } from '@/components/home/DownloadApp';
import { Hero } from '@/components/home/Hero';

export default function HomePage({ params }: { params: { locale: string } }) {
  // Обязательно для статического рендеринга: Hero/Advantages используют переводы на сервере
  setRequestLocale(params.locale);

  return (
    <>
      <Hero />
      <Advantages />
      <DownloadApp />
      <CtaBand />
    </>
  );
}
