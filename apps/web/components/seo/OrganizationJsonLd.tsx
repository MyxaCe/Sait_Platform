import { legalNameFromEnv } from '@/lib/brand';
import { SITE_URL } from '@/lib/site';

interface OrganizationJsonLdProps {
  name: string;
  description: string;
  logoUrl: string | null;
}

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
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      availableLanguage: ['Russian', 'English'],
      url: `${SITE_URL}/company/contacts`,
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
