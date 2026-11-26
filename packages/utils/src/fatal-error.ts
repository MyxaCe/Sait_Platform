/**
 * Тексты страницы критической ошибки (global-error). Она заменяет весь корневой layout:
 * переводов next-intl и сети там нет, поэтому тексты здесь, а язык угадываем по адресу,
 * затем по cookie языка, затем по языку браузера (ТД-009 п.5).
 */
export const FATAL_ERROR_LOCALES = ['ru', 'en', 'de', 'fr', 'es'] as const;
export type FatalErrorLocale = (typeof FATAL_ERROR_LOCALES)[number];

export interface FatalErrorText {
  readonly title: string;
  readonly body: string;
  readonly retry: string;
}

type Texts = Readonly<Record<FatalErrorLocale, FatalErrorText>>;

export const FATAL_ERROR_TEXTS: Readonly<Record<'site' | 'cabinet', Texts>> = {
  site: {
    ru: { title: 'Сайт временно недоступен', body: 'Мы уже знаем о проблеме. Попробуйте обновить страницу через пару минут.', retry: 'Обновить страницу' },
    en: { title: 'The site is temporarily unavailable', body: 'We already know about the problem. Please refresh the page in a couple of minutes.', retry: 'Refresh the page' },
    de: { title: 'Die Website ist vorübergehend nicht verfügbar', body: 'Wir kennen das Problem bereits. Bitte laden Sie die Seite in ein paar Minuten neu.', retry: 'Seite neu laden' },
    fr: { title: 'Le site est temporairement indisponible', body: 'Nous sommes déjà informés du problème. Veuillez actualiser la page dans quelques minutes.', retry: 'Actualiser la page' },
    es: { title: 'El sitio no está disponible temporalmente', body: 'Ya conocemos el problema. Actualice la página en un par de minutos.', retry: 'Actualizar la página' },
  },
  cabinet: {
    ru: { title: 'Что-то пошло не так', body: 'Мы уже знаем о проблеме. Ваши средства и позиции в безопасности. Попробуйте обновить страницу.', retry: 'Обновить страницу' },
    en: { title: 'Something went wrong', body: 'We already know about the problem. Your funds and positions are safe. Please refresh the page.', retry: 'Refresh the page' },
    de: { title: 'Etwas ist schiefgelaufen', body: 'Wir kennen das Problem bereits. Ihre Gelder und Positionen sind sicher. Bitte laden Sie die Seite neu.', retry: 'Seite neu laden' },
    fr: { title: 'Une erreur est survenue', body: 'Nous sommes déjà informés du problème. Vos fonds et positions sont en sécurité. Veuillez actualiser la page.', retry: 'Actualiser la page' },
    es: { title: 'Algo salió mal', body: 'Ya conocemos el problema. Sus fondos y posiciones están seguros. Actualice la página.', retry: 'Actualizar la página' },
  },
};

const isLocale = (v: string | null | undefined): v is FatalErrorLocale =>
  !!v && (FATAL_ERROR_LOCALES as readonly string[]).includes(v);

/** Язык страницы ошибки: префикс пути → cookie NEXT_LOCALE → язык браузера → русский. */
export function fatalErrorLocale(input: { pathname?: string; cookie?: string; languages?: readonly string[] }): FatalErrorLocale {
  const first = (input.pathname ?? '').split('/').filter(Boolean)[0]?.toLowerCase();
  if (isLocale(first)) return first;
  const fromCookie = /(?:^|;\s*)NEXT_LOCALE=([a-z]{2})/i.exec(input.cookie ?? '')?.[1]?.toLowerCase();
  if (isLocale(fromCookie)) return fromCookie;
  for (const lang of input.languages ?? []) {
    const short = lang.slice(0, 2).toLowerCase();
    if (isLocale(short)) return short;
  }
  return 'ru';
}

/** Для клиентского компонента: читает адрес, cookie и язык браузера без сети. */
export function detectFatalErrorLocale(): FatalErrorLocale {
  if (typeof window === 'undefined') return 'ru';
  return fatalErrorLocale({
    pathname: window.location.pathname,
    cookie: document.cookie,
    languages: navigator.languages?.length ? navigator.languages : [navigator.language],
  });
}
