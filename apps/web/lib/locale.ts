import { intlTag, isPlatformLocale, type PlatformLocale } from '@broker/utils/locales';

export function pageLocale(value: string): PlatformLocale {
  return isPlatformLocale(value) ? value : 'ru';
}

export { intlTag };

export function leadLocale(raw: unknown): 'ru' | 'en' {
  return raw !== 'ru' && isPlatformLocale(raw) ? 'en' : 'ru';
}
