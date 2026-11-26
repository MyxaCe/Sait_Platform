import { describe, expect, it } from 'vitest';
import { FATAL_ERROR_LOCALES, FATAL_ERROR_TEXTS, fatalErrorLocale } from './fatal-error';

describe('страница критической ошибки на языке клиента (ТД-009 п.5)', () => {
  it('тексты есть на всех 5 языках для витрины и кабинета', () => {
    for (const kind of ['site', 'cabinet'] as const) {
      for (const l of FATAL_ERROR_LOCALES) {
        const t = FATAL_ERROR_TEXTS[kind][l];
        expect(t.title.length * t.body.length * t.retry.length).toBeGreaterThan(0);
      }
    }
  });

  it('язык: путь → cookie → браузер → русский', () => {
    expect(fatalErrorLocale({ pathname: '/de/instruments' })).toBe('de');
    expect(fatalErrorLocale({ pathname: '/instruments', cookie: 'a=1; NEXT_LOCALE=fr' })).toBe('fr');
    expect(fatalErrorLocale({ pathname: '/', languages: ['es-ES', 'en'] })).toBe('es');
    expect(fatalErrorLocale({ pathname: '/', languages: ['pt-BR'] })).toBe('ru');
    expect(fatalErrorLocale({ pathname: '/xx/page', cookie: 'NEXT_LOCALE=zz' })).toBe('ru');
  });
});
