import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/articles', () => ({ loadNews: vi.fn() }));
vi.mock('@/lib/cms', () => ({ getCms: vi.fn() }));

import { emptySectionsFrom, sectionPathOf, withoutEmptyColumns, withoutEmptyLinks } from './empty-sections';

const full = { blogPosts: 1, news: 3, vacancies: 1, legalEntity: true, partnerBlocks: 2, webinarsAndStreams: 4 };

describe('emptySectionsFrom', () => {
  it('прячет только то, что CMS вернула пустым', () => {
    expect([...emptySectionsFrom(full)]).toEqual([]);
    expect([...emptySectionsFrom({ ...full, blogPosts: 0, news: 0, vacancies: 0 })]).toEqual([
      '/blog',
      '/analytics/news',
      '/company/careers',
    ]);
  });

  it('сбой CMS (null) раздел не прячет', () => {
    expect(
      [...emptySectionsFrom({ blogPosts: 1, news: null, vacancies: null, legalEntity: null, partnerBlocks: null, webinarsAndStreams: null })],
    ).toEqual([]);
  });

  it('нет юрлица — прячется страница регулирования', () => {
    expect(emptySectionsFrom({ ...full, legalEntity: false }).has('/company/regulation')).toBe(true);
  });
});

describe('ссылки меню', () => {
  const locales = ['ru', 'en'];
  const empty = new Set(['/blog', '/analytics/news']);

  it('путь ссылки без языка, query и внешних адресов', () => {
    expect(sectionPathOf('/en/blog?x=1#a', locales)).toBe('/blog');
    expect(sectionPathOf('/blog', locales)).toBe('/blog');
    expect(sectionPathOf('https://t.me/x', locales)).toBeNull();
  });

  it('убирает ссылки на пустые разделы и их подстраницы, не трогая похожие', () => {
    const links = [
      { href: '/blog' },
      { href: '/en/analytics/news/abc' },
      { href: '/analytics/calendar' },
      { href: '/blogger' },
      { href: 'https://example.test/blog' },
    ];
    expect(withoutEmptyLinks(links, empty, locales).map((l) => l.href)).toEqual([
      '/analytics/calendar',
      '/blogger',
      'https://example.test/blog',
    ]);
  });

  it('колонка подвала без ссылок исчезает', () => {
    const cols = [
      { title: 'A', links: [{ href: '/blog' }] },
      { title: 'B', links: [{ href: '/about' }] },
    ];
    expect(withoutEmptyColumns(cols, empty, locales).map((c) => c.title)).toEqual(['B']);
  });
});
