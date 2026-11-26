import { NextResponse } from 'next/server';
import { getChromeBrand } from '@/lib/chrome';
import { isPlatformLocale } from '@broker/utils/locales';

export const dynamic = 'force-dynamic';

// Бренд сайта для терминала (TERMINAL_CONFIG.brandUrl). CMS закрыта фильтром по IP, поэтому терминал
// берёт бренд у кабинета. Данные публичные (название, логотип, цвет, режим показа) — без секретов.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('locale') ?? 'ru';
  const locale = isPlatformLocale(raw) ? raw : 'ru';
  const brand = await getChromeBrand(locale);
  if (!brand) {
    return NextResponse.json({ error: 'unavailable' }, { status: 503, headers: { ...CORS, 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json(
    {
      name: brand.name,
      logo: brand.logo,
      favicon: null,
      primaryColor: brand.primaryColor,
      logoMode: brand.logoMode ?? 'logo-name',
    },
    { headers: { ...CORS, 'Cache-Control': 'public, max-age=300' } },
  );
}
