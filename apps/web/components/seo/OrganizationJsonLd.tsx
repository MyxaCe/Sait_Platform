import { SITE_NAME, SITE_URL } from '@/lib/site';

/**
 * JSON-LD Organization/FinancialService — глобальная микроразметка компании.
 * Рендерится один раз в корневом layout.
 */
export function OrganizationJsonLd() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FinancialService',
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/icons/icon-512.png`,
    description: 'Торговая платформа: Forex, CFD на акции, криптовалюты, индексы и металлы.',
    // foundingDate убран: «2009» не подтверждён ничем. Микроразметку читают
    // поисковики и агрегаторы — выдуманный факт расходится отсюда дальше сайта.
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      availableLanguage: ['Russian', 'English'],
      url: `${SITE_URL}/company/contacts`,
    },
    // sameAs убран до появления реальных профилей: t.me/apexcapital и
    // youtube.com/@apexcapital нам не принадлежат — разметка объявляла
    // чужие аккаунты нашими.
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
