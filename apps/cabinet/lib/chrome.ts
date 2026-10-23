/**
 * Хром кабинета из CMS (ADR-025 / вариант A): бренд (имя, логотип, акцент)
 * и футер — те же данные, что у сайта, тот же тенант (SITE_SLUG).
 * CMS недоступна → null: кабинет рендерит статический фолбэк
 * (буква-логотип, палитра токенов, без футерных колонок) — рабочий,
 * просто без брендирования. Обновление — revalidate 5 мин.
 */

import { readTenantSlug } from '@broker/tenant';
import { envOr } from '@broker/utils';

export interface ChromeBrand {
  name: string;
  /**
   * `null` — цвет не задан. В CMS v2 это штатное значение (Р-040), и
   * кабинет остаётся на палитре токенов: акцент не инжектируется вовсе.
   * Решение, а не побочное свойство — см. `app/[locale]/layout.tsx`.
   */
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
  // Слага может не быть на сборке — тогда хрома из CMS нет и кабинет
  // рисует свой статический фолбэк. Подставлять чужой слаг нельзя:
  // кабинет показал бы чужой бренд (PKG-05).
  return readTenantSlug(process.env.SITE_SLUG);
}

export async function cmsGet(resource: string, locale: string): Promise<unknown | null> {
  const base = cmsUrl();
  if (!base) return null;

  // АДРЕС БЕЗ СЛАГА НЕ СОБИРАЕТСЯ ВОВСЕ (PKG-05, приём `terminal`).
  // `?site=` — не «без фильтра», а «сайт по умолчанию»: CMS ответила бы
  // 200 с чужим брендом, и кабинет показал бы его как свой. Строка
  // запроса, собранная из пустого значения, выглядит исправной — это и
  // делает её опасной.
  const slug = siteSlug();
  if (slug === null) {
    console.error(
      `[chrome] SITE_SLUG не задан — хром из CMS не запрашиваем (${resource}): ` +
        'запрос без слага вернул бы чужой бренд (PKG-05).',
    );
    return null;
  }

  try {
    const res = await fetch(
      `${base}/cms/${resource}?site=${encodeURIComponent(slug)}&locale=${locale === 'en' ? 'en' : 'ru'}`,
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
  // Незаданный цвет НЕ отменяет бренд целиком. Прежде отменял: условие
  // требовало строки, и после переезда на v2 (`primaryColor: null` —
  // штатное значение) кабинет потерял бы заодно имя, логотип и соцсети.
  // Отсутствие одного необязательного поля не доказывает отсутствия
  // остальных.
  if (!data || typeof data.name !== 'string') return null;
  const logo = data.logo as ChromeBrand['logo'] | null;
  return {
    name: data.name,
    primaryColor: typeof data.primaryColor === 'string' ? data.primaryColor : null,
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
  // Пустая строка — не отсутствие (WEB-21).
  const site = envOr(process.env.NEXT_PUBLIC_SITE_URL, 'http://localhost:3000').replace(/\/$/, '');
  const localized = locale === 'en' ? `/en${href === '/' ? '' : href}` : href;
  return `${site}${localized || '/'}`;
}
