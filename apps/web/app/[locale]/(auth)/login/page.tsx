import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cabinetLoginHref } from '@/lib/cabinet-links';
import { getSiteLanguages } from '@/lib/site-languages';

interface PageProps {
  params: { locale: string };
}

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false } };

/** Вход — в кабинете. Старый адрес витрины переадресует туда с языком. */
export default async function LoginPage({ params }: PageProps) {
  const { defaultLanguage } = await getSiteLanguages();
  redirect(cabinetLoginHref(params.locale, defaultLanguage));
}
