export const PLATFORM_LOCALES = ['ru', 'en', 'de', 'fr', 'es'] as const;

export type PlatformLocale = (typeof PLATFORM_LOCALES)[number];

export const INTL_TAGS: Readonly<Record<PlatformLocale, string>> = {
  ru: 'ru-RU',
  en: 'en-US',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
};

export const LOCALE_AUTONYMS: Readonly<Record<PlatformLocale, string>> = {
  ru: 'Русский',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
};

export const OPEN_GRAPH_LOCALES: Readonly<Record<PlatformLocale, string>> = {
  ru: 'ru_RU',
  en: 'en_US',
  de: 'de_DE',
  fr: 'fr_FR',
  es: 'es_ES',
};

export const LOCALE_COOKIE = 'NEXT_LOCALE';

export interface SiteLanguages {
  readonly languages: readonly PlatformLocale[];
  readonly defaultLanguage: PlatformLocale;
}

export const COMPAT_SITE_LANGUAGES: SiteLanguages = Object.freeze({
  languages: Object.freeze(['ru', 'en'] as PlatformLocale[]),
  defaultLanguage: 'ru',
});

export function isPlatformLocale(value: unknown): value is PlatformLocale {
  return typeof value === 'string' && (PLATFORM_LOCALES as readonly string[]).includes(value);
}

export function intlTag(locale: string): string {
  return isPlatformLocale(locale) ? INTL_TAGS[locale] : INTL_TAGS.en;
}

export function readSiteLanguages(card: unknown): SiteLanguages {
  if (typeof card !== 'object' || card === null) return COMPAT_SITE_LANGUAGES;
  const { languages, defaultLanguage } = card as { languages?: unknown; defaultLanguage?: unknown };
  if (!Array.isArray(languages)) return COMPAT_SITE_LANGUAGES;
  const list = [...new Set(languages.filter(isPlatformLocale))];
  if (list.length === 0) return COMPAT_SITE_LANGUAGES;
  const fallback = list.includes('ru') ? 'ru' : list[0]!;
  return {
    languages: list,
    defaultLanguage: isPlatformLocale(defaultLanguage) && list.includes(defaultLanguage) ? defaultLanguage : fallback,
  };
}

export function isSiteLanguage(site: SiteLanguages, locale: string): locale is PlatformLocale {
  return (site.languages as readonly string[]).includes(locale);
}

export function stripLocalePrefix(pathname: string): { locale: PlatformLocale | null; path: string } {
  const match = /^\/([a-z]{2})(?=\/|$)(.*)$/.exec(pathname);
  if (!match || !isPlatformLocale(match[1])) return { locale: null, path: pathname || '/' };
  return { locale: match[1], path: match[2] || '/' };
}

export function localizedPath(path: string, locale: string, defaultLanguage: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  if (locale === defaultLanguage) return clean;
  if (clean === '/') return `/${locale}`;
  if (clean.startsWith('/?') || clean.startsWith('/#')) return `/${locale}${clean.slice(1)}`;
  return `/${locale}${clean}`;
}

export function localeCookieDomain(...candidates: (string | undefined)[]): string | undefined {
  for (const raw of candidates) {
    const value = raw?.trim();
    if (value) return value;
  }
  return undefined;
}

export function legacyLocale(value: unknown): 'ru' | 'en' {
  return value !== 'ru' && isPlatformLocale(value) ? 'en' : 'ru';
}
