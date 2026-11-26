import { NextResponse } from 'next/server';
import { getChromeBrand } from '@/lib/chrome';
import { isPlatformLocale } from '@broker/utils/locales';
import { absoluteMediaUrl } from '@broker/api-client';
import { readEnv } from '@broker/utils';

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
  // Терминал живёт на другом поддомене: логотип (/media/… кабинета) отдаём абсолютной ссылкой.
  const origin = readEnv(process.env.CABINET_PUBLIC_URL) ?? new URL(request.url).origin;
  const logo = brand.logo ? { ...brand.logo, url: absoluteMediaUrl(brand.logo.url, origin) } : null;
  return NextResponse.json(
    {
      name: brand.name,
      logo,
      favicon: null,
      primaryColor: brand.primaryColor,
      logoMode: brand.logoMode ?? 'logo-name',
    },
    { headers: { ...CORS, 'Cache-Control': 'public, max-age=300' } },
  );
}
