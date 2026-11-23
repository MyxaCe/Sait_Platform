import type { LegalEntity } from '@broker/api-client';

const LANGUAGE_NAMES: Record<string, string> = {
  ru: 'Russian',
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
};

export interface OrganizationInput {
  siteUrl: string;
  name: string;
  description: string;
  logoUrl: string | null;
  /** Юрлицо из CMS; null — блок не заполнен, юридических полей в разметке нет. */
  legalEntity: LegalEntity | null;
  /** Запасное юр. название из окружения (старый способ). */
  legalNameFallback: string | null;
  socials: { url: string }[];
  languages: readonly string[];
}

/**
 * Разметка организации только из настоящих данных (разбор доверия 22.11):
 * юрназвание, рег. номер и адрес попадают в разметку, только если они
 * заполнены в CMS. Ничего не подставляем «для красоты».
 */
export function organizationJsonLd(input: OrganizationInput): Record<string, unknown> {
  const site = input.siteUrl.replace(/\/$/, '');
  const legalName = input.legalEntity?.name || input.legalNameFallback || null;
  const sameAs = input.socials.map((s) => s.url).filter((u) => /^https:\/\//.test(u));
  const languages = input.languages.map((l) => LANGUAGE_NAMES[l]).filter((l): l is string => Boolean(l));
  return {
    '@context': 'https://schema.org',
    '@type': 'FinancialService',
    name: input.name,
    ...(legalName ? { legalName } : {}),
    ...(input.legalEntity?.registrationNumber ? { identifier: input.legalEntity.registrationNumber } : {}),
    ...(input.legalEntity?.address ? { address: input.legalEntity.address } : {}),
    url: site,
    logo: input.logoUrl ?? `${site}/icons/icon-512.png`,
    description: input.description,
    ...(sameAs.length > 0 ? { sameAs } : {}),
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      ...(languages.length > 0 ? { availableLanguage: languages } : {}),
      url: `${site}/company/contacts`,
    },
  };
}

export interface Crumb {
  name: string;
  url: string;
}

export function breadcrumbJsonLd(crumbs: Crumb[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url })),
  };
}

/** Безопасная вставка JSON-LD: `</script>` внутри строк не закроет тег. */
export function jsonLdHtml(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
