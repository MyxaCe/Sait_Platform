import { legalNameFromEnv } from '@/lib/brand';
import { SITE_URL } from '@/lib/site';

interface OrganizationJsonLdProps {
  /** Имя бренда — из CMS (`cms:brand`) */
  name: string;
  /** Описание сайта — SEO-текст (`messages.meta.description`, до CMS v2) */
  description: string;
  /** Логотип из CMS; нет — иконка приложения */
  logoUrl: string | null;
}

/**
 * JSON-LD Organization/FinancialService — глобальная микроразметка компании.
 * Рендерится один раз в корневом layout.
 *
 * Имени и описания в коде нет (10.11): они приходят параметрами из CMS.
 * Юридического имени в legacy CMS нет — мост из окружения `SITE_LEGAL_NAME`
 * (в CMS v2 — `seo-profiles.organization`); не задано — поля нет вовсе.
 */
export function OrganizationJsonLd({ name, description, logoUrl }: OrganizationJsonLdProps) {
  const legalName = legalNameFromEnv();
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FinancialService',
    name,
    ...(legalName ? { legalName } : {}),
    url: SITE_URL,
    logo: logoUrl ?? `${SITE_URL}/icons/icon-512.png`,
    description,
    // foundingDate убран: «2009» не подтверждён ничем. Микроразметку читают
    // поисковики и агрегаторы — выдуманный факт расходится отсюда дальше сайта.
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      availableLanguage: ['Russian', 'English'],
      url: `${SITE_URL}/company/contacts`,
    },
    // sameAs не выводится до появления подтверждённых профилей: соцсети в
    // legacy CMS (t.me/…, youtube.com/@…) нам не принадлежат (аудит 10.11).
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
