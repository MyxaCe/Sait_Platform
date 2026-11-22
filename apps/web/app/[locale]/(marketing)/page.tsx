import { pageLocale } from '@/lib/locale';
import { setRequestLocale } from 'next-intl/server';
import { Advantages } from '@/components/home/Advantages';
import { CtaBand } from '@/components/home/CtaBand';
import { DownloadApp } from '@/components/home/DownloadApp';
import { Hero } from '@/components/home/Hero';
import { readHeroBackground } from '@/features/hero-backdrop/mode';
import { getCms } from '@/lib/cms';

export default async function HomePage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const locale = pageLocale(params.locale);
  const [brand, instruments] = await Promise.all([
    getCms('brand', { locale }),
    getCms('instruments', { locale }),
  ]);

  return (
    <>
      <Hero
        background={readHeroBackground(brand)}
        symbols={instruments.items.map((i) => i.symbol)}
      />
      <Advantages />
      <DownloadApp brandName={brand.name} />
      <CtaBand />
    </>
  );
}
