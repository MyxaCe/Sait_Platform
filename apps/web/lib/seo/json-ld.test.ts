import { describe, expect, it } from 'vitest';
import { breadcrumbJsonLd, jsonLdHtml, organizationJsonLd } from './json-ld';

const base = {
  siteUrl: 'https://example.test/',
  name: 'Brand',
  description: 'desc',
  logoUrl: null,
  legalNameFallback: null,
  socials: [],
  languages: ['ru', 'en'] as const,
};

describe('organizationJsonLd', () => {
  it('без юрлица в CMS — никаких юридических полей, ничего не выдумываем', () => {
    const ld = organizationJsonLd({ ...base, legalEntity: null });
    expect(ld).not.toHaveProperty('legalName');
    expect(ld).not.toHaveProperty('identifier');
    expect(ld).not.toHaveProperty('address');
    expect(ld).not.toHaveProperty('sameAs');
    expect(ld.url).toBe('https://example.test');
    expect((ld.contactPoint as { availableLanguage: string[] }).availableLanguage).toEqual(['Russian', 'English']);
  });

  it('заполненные в CMS поля попадают в разметку, соцсети только https', () => {
    const ld = organizationJsonLd({
      ...base,
      legalEntity: { name: 'Legal Ltd', registrationNumber: 'R-1', address: 'Street 1', licenses: [] },
      socials: [{ url: 'https://t.me/x' }, { url: 'javascript:alert(1)' }],
      languages: ['ru', 'xx'],
    });
    expect(ld).toMatchObject({ legalName: 'Legal Ltd', identifier: 'R-1', address: 'Street 1', sameAs: ['https://t.me/x'] });
    expect((ld.contactPoint as { availableLanguage: string[] }).availableLanguage).toEqual(['Russian']);
  });
});

describe('breadcrumbJsonLd / jsonLdHtml', () => {
  it('позиции по порядку', () => {
    const ld = breadcrumbJsonLd([
      { name: 'A', url: 'https://example.test/a' },
      { name: 'B', url: 'https://example.test/a/b' },
    ]);
    expect((ld.itemListElement as { position: number }[]).map((i) => i.position)).toEqual([1, 2]);
  });

  it('закрывающий тег внутри данных экранируется', () => {
    expect(jsonLdHtml({ t: '</script><b>' })).not.toContain('</script>');
  });
});
