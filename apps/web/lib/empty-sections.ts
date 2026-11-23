import type { ContentLocale } from '@broker/api-client';
import { loadNews } from '@/lib/articles';
import { getCms } from '@/lib/cms';

/**
 * Пустые разделы витрины (разбор доверия 22.11): раздел без контента не
 * показываем вовсе — ни страницу с «пока нет», ни ссылку в меню.
 * Пустым считаем только то, что CMS вернула и в нём ничего нет; сбой CMS
 * разделы не прячет (там свои честные плашки и последняя удачная версия).
 */
export const EMPTY_CHECKED_SECTIONS = [
  '/blog',
  '/analytics/news',
  '/company/careers',
  '/company/regulation',
  '/partners',
  '/education/webinars',
] as const;
export type CheckedSection = (typeof EMPTY_CHECKED_SECTIONS)[number];

export interface SectionContent {
  /** Блог: источника контента нет — раздел всегда пуст. */
  blogPosts: number;
  news: number | null;
  vacancies: number | null;
  legalEntity: boolean | null;
  partnerBlocks: number | null;
  webinarsAndStreams: number | null;
}

export function emptySectionsFrom(c: SectionContent): Set<CheckedSection> {
  const out = new Set<CheckedSection>();
  if (c.blogPosts === 0) out.add('/blog');
  if (c.news === 0) out.add('/analytics/news');
  if (c.vacancies === 0) out.add('/company/careers');
  if (c.legalEntity === false) out.add('/company/regulation');
  if (c.partnerBlocks === 0) out.add('/partners');
  if (c.webinarsAndStreams === 0) out.add('/education/webinars');
  return out;
}

async function count<T>(load: () => Promise<T>, measure: (value: T) => number): Promise<number | null> {
  try {
    return measure(await load());
  } catch {
    return null;
  }
}

export async function loadSectionContent(locale: ContentLocale): Promise<SectionContent> {
  const [news, vacancies, legalEntity, partnerBlocks, webinarsAndStreams] = await Promise.all([
    count(() => loadNews(locale), (items) => items.length),
    count(() => getCms('careers', { locale }), (r) => r.vacancies.length),
    count(() => getCms('brand', { locale }), (b) => (b.legalEntity ? 1 : 0)),
    count(() => getCms('partners', { locale }), (r) => r.models.length + r.tiers.length + r.steps.length),
    count(
      () => Promise.all([getCms('academy', { locale }), getCms('streams', { locale, revalidate: 60 })]),
      ([academy, streams]) => academy.webinars.length + streams.items.length,
    ),
  ]);
  return {
    blogPosts: 0,
    news,
    vacancies,
    legalEntity: legalEntity === null ? null : legalEntity > 0,
    partnerBlocks,
    webinarsAndStreams,
  };
}

export async function emptySections(locale: ContentLocale): Promise<Set<CheckedSection>> {
  return emptySectionsFrom(await loadSectionContent(locale));
}

/** Путь ссылки без домена витрины, языкового префикса, query и hash. */
export function sectionPathOf(href: string, locales: readonly string[]): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return null;
  const path = href.split(/[?#]/)[0] ?? '';
  const parts = path.split('/').filter(Boolean);
  if (parts[0] && locales.includes(parts[0])) parts.shift();
  return '/' + parts.join('/');
}

function hiddenBy(href: string, empty: ReadonlySet<string>, locales: readonly string[]): boolean {
  const path = sectionPathOf(href, locales);
  if (path === null) return false;
  for (const section of empty) {
    if (path === section || path.startsWith(section + '/')) return true;
  }
  return false;
}

export interface LinkLike {
  href: string;
}

export function withoutEmptyLinks<T extends LinkLike>(links: readonly T[], empty: ReadonlySet<string>, locales: readonly string[]): T[] {
  return links.filter((l) => !hiddenBy(l.href, empty, locales));
}

export function withoutEmptyColumns<C extends { links: LinkLike[] }>(
  columns: readonly C[],
  empty: ReadonlySet<string>,
  locales: readonly string[],
): C[] {
  return columns
    .map((c) => ({ ...c, links: withoutEmptyLinks(c.links, empty, locales) }))
    .filter((c) => c.links.length > 0);
}
