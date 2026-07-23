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
    description:
      'Международный онлайн-брокер: торговля Forex, CFD на акции, криптовалюты, индексы и металлы.',
    foundingDate: '2009',
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      availableLanguage: ['Russian', 'English'],
      url: `${SITE_URL}/company/contacts`,
    },
    sameAs: [
      // TODO: реальные профили компании
      'https://t.me/apexcapital',
      'https://www.youtube.com/@apexcapital',
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
