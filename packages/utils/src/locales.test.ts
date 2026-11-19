import { describe, expect, it } from 'vitest';
import {
  COMPAT_SITE_LANGUAGES,
  intlTag,
  localeCookieDomain,
  localizedPath,
  readSiteLanguages,
  stripLocalePrefix,
} from './locales';

describe('readSiteLanguages', () => {
  it('без полей — совместимое умолчание ru/en, ru', () => {
    expect(readSiteLanguages({})).toEqual(COMPAT_SITE_LANGUAGES);
    expect(readSiteLanguages(null)).toEqual(COMPAT_SITE_LANGUAGES);
    expect(readSiteLanguages({ languages: [] })).toEqual(COMPAT_SITE_LANGUAGES);
    expect(readSiteLanguages({ languages: ['xx'] })).toEqual(COMPAT_SITE_LANGUAGES);
  });

  it('читает список и язык по умолчанию, отбрасывая неизвестные коды', () => {
    expect(readSiteLanguages({ languages: ['de', 'en', 'xx', 'de'], defaultLanguage: 'de' })).toEqual({
      languages: ['de', 'en'],
      defaultLanguage: 'de',
    });
  });

  it('язык по умолчанию вне списка — ru из списка, иначе первый', () => {
    expect(readSiteLanguages({ languages: ['en', 'ru'], defaultLanguage: 'fr' }).defaultLanguage).toBe('ru');
    expect(readSiteLanguages({ languages: ['es', 'fr'] }).defaultLanguage).toBe('es');
  });
});

describe('адреса', () => {
  it('язык по умолчанию — без префикса, остальные — с префиксом', () => {
    expect(localizedPath('/instruments', 'ru', 'ru')).toBe('/instruments');
    expect(localizedPath('/instruments', 'en', 'ru')).toBe('/en/instruments');
    expect(localizedPath('/', 'de', 'ru')).toBe('/de');
    expect(localizedPath('/', 'de', 'de')).toBe('/');
    expect(localizedPath('/?a=1', 'fr', 'ru')).toBe('/fr?a=1');
    expect(localizedPath('/company/contacts#write-us', 'ru', 'de')).toBe('/ru/company/contacts#write-us');
  });

  it('снимает префикс только известного языка', () => {
    expect(stripLocalePrefix('/de/instruments')).toEqual({ locale: 'de', path: '/instruments' });
    expect(stripLocalePrefix('/fr')).toEqual({ locale: 'fr', path: '/' });
    expect(stripLocalePrefix('/instruments')).toEqual({ locale: null, path: '/instruments' });
    expect(stripLocalePrefix('/it/x')).toEqual({ locale: null, path: '/it/x' });
  });
});

describe('форматы и cookie', () => {
  it('теги Intl по договору', () => {
    expect(['ru', 'en', 'de', 'fr', 'es'].map(intlTag)).toEqual(['ru-RU', 'en-US', 'de-DE', 'fr-FR', 'es-ES']);
  });

  it('домен cookie — первый непустой', () => {
    expect(localeCookieDomain(undefined, ' ', '.example.com')).toBe('.example.com');
    expect(localeCookieDomain(undefined, '')).toBeUndefined();
  });
});
