import { readTenantSlug } from '@broker/tenant';
import { envOr, readEnv } from '@broker/utils';
import { isPlatformLocale, localizedPath } from '@broker/utils/locales';
import { withLiveParams } from './live-params';

export interface ChromeBrand {
  name: string;
  primaryColor: string | null;
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

function siteSlug(): string | null {
  return readTenantSlug(process.env.SITE_SLUG);
}

export async function cmsGet(resource: string, locale: string): Promise<unknown | null> {
  const base = cmsUrl();
  if (!base) return null;

  const slug = siteSlug();
  if (slug === null) {
    console.error(
      `[chrome] SITE_SLUG не задан — хром из CMS не запрашиваем (${resource}): ` +
        'запрос без слага вернул бы чужой бренд (PKG-05).',
    );
    return null;
  }

  let data: unknown;
  try {
    const res = await fetch(
      `${base}/cms/${resource}?site=${encodeURIComponent(slug)}&locale=${isPlatformLocale(locale) ? locale : 'ru'}`,
      {
        headers: process.env.CMS_API_KEY ? { 'X-API-Key': process.env.CMS_API_KEY } : {},
        next: { revalidate: 300 },
        signal: AbortSignal.timeout(3_000),
      },
    );
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }
  return withLiveParams(data, isPlatformLocale(locale) ? locale : 'ru');
}

export async function getChromeBrand(locale: string): Promise<ChromeBrand | null> {
  const data = (await cmsGet('brand', locale)) as Record<string, unknown> | null;
  if (!data || typeof data.name !== 'string') return null;
  const logo = data.logo as ChromeBrand['logo'] | null;
  return {
    name: data.name,
    primaryColor: typeof data.primaryColor === 'string' ? data.primaryColor : null,
    logo: logo && typeof logo.url === 'string' ? logo : null,
    socials: Array.isArray(data.socials) ? (data.socials as ChromeBrand['socials']) : [],
  };
}

export function resolveBrandName(brand: ChromeBrand | null, neutral: string): string {
  return brand?.name ?? readEnv(process.env.SITE_BRAND_NAME) ?? neutral;
}

export async function getChromeFooter(locale: string): Promise<ChromeFooter | null> {
  const data = (await cmsGet('navigation', locale)) as { footer?: ChromeFooter } | null;
  if (!data?.footer || !Array.isArray(data.footer.columns)) return null;
  return data.footer;
}

export function siteHref(href: string, locale: string, defaultLanguage: string): string {
  const site = envOr(process.env.NEXT_PUBLIC_SITE_URL, 'http://localhost:3000').replace(/\/$/, '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return href;
  return `${site}${localizedPath(href || '/', locale, defaultLanguage)}`;
}
