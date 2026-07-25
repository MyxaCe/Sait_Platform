/**
 * Хром кабинета из CMS (ADR-025 / вариант A): бренд (имя, логотип, акцент)
 * и футер — те же данные, что у сайта, тот же тенант (SITE_SLUG).
 * CMS недоступна → null: кабинет рендерит статический фолбэк
 * (буква-логотип, палитра токенов, без футерных колонок) — рабочий,
 * просто без брендирования. Обновление — revalidate 5 мин.
 */

export interface ChromeBrand {
  name: string;
  primaryColor: string;
  logo: { url: string; width: number; height: number; alt: string } | null;
  socials: { name: string; url: string }[];
}

export interface ChromeFooter {
  columns: { title: string; links: { href: string; label: string }[] }[];
  riskWarning: string;
}

function cmsUrl(): string | null {
  const base = process.env.CMS_API_URL;
  return base ? base.replace(/\/$/, '') : null;
}

function siteSlug(): string {
  return process.env.SITE_SLUG ?? 'apex-ru';
}

async function cmsGet(resource: string, locale: string): Promise<unknown | null> {
  const base = cmsUrl();
  if (!base) return null;
  try {
    const res = await fetch(
      `${base}/cms/${resource}?site=${siteSlug()}&locale=${locale === 'en' ? 'en' : 'ru'}`,
      {
        headers: process.env.CMS_API_KEY ? { 'X-API-Key': process.env.CMS_API_KEY } : {},
        next: { revalidate: 300 },
        signal: AbortSignal.timeout(3_000),
      },
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function getChromeBrand(locale: string): Promise<ChromeBrand | null> {
  const data = (await cmsGet('brand', locale)) as Record<string, unknown> | null;
  if (!data || typeof data.name !== 'string' || typeof data.primaryColor !== 'string') return null;
  const logo = data.logo as ChromeBrand['logo'] | null;
  return {
    name: data.name,
    primaryColor: data.primaryColor,
    logo: logo && typeof logo.url === 'string' ? logo : null,
    socials: Array.isArray(data.socials) ? (data.socials as ChromeBrand['socials']) : [],
  };
}

export async function getChromeFooter(locale: string): Promise<ChromeFooter | null> {
  const data = (await cmsGet('navigation', locale)) as { footer?: ChromeFooter } | null;
  if (!data?.footer || !Array.isArray(data.footer.columns)) return null;
  return data.footer;
}

/** Абсолютная ссылка футера кабинета на страницу САЙТА (с учётом локали). */
export function siteHref(href: string, locale: string): string {
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const localized = locale === 'en' ? `/en${href === '/' ? '' : href}` : href;
  return `${site}${localized || '/'}`;
}
