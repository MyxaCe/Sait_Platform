import type { LegalEntity } from '@broker/api-client';
import { legalNameFromEnv } from '@/lib/brand';
import { jsonLdHtml, organizationJsonLd } from '@/lib/seo/json-ld';
import { SITE_URL } from '@/lib/site';

interface OrganizationJsonLdProps {
  name: string;
  description: string;
  logoUrl: string | null;
  legalEntity: LegalEntity | null;
  socials: { url: string }[];
  languages: readonly string[];
}

export function OrganizationJsonLd({ name, description, logoUrl, legalEntity, socials, languages }: OrganizationJsonLdProps) {
  const jsonLd = organizationJsonLd({
    siteUrl: SITE_URL,
    name,
    description,
    logoUrl,
    legalEntity,
    legalNameFallback: legalNameFromEnv(),
    socials,
    languages,
  });
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }} />;
}
