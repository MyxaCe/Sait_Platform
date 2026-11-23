import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cabinetRegisterRedirect } from '@/lib/cabinet-links';
import { getSiteLanguages } from '@/lib/site-languages';

interface PageProps {
  params: { locale: string };
  searchParams?: Record<string, string | string[] | undefined>;
}

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false } };

/**
 * Регистрация одна — в кабинете. Старый адрес витрины (ссылки, ярлык PWA, закладки)
 * переадресует туда с языком и параметрами (тариф, промокод, реферал).
 */
export default async function RegisterPage({ params, searchParams }: PageProps) {
  const { defaultLanguage } = await getSiteLanguages();
  redirect(cabinetRegisterRedirect(searchParams, params.locale, defaultLanguage));
}
