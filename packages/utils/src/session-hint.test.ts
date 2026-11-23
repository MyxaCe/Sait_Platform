import { describe, expect, it } from 'vitest';
import { SESSION_HINT_COOKIE, hasSessionHint, sessionHintDomain } from './session-hint';

describe('подсказка входа для витрины', () => {
  it('читается только точное значение 1', () => {
    expect(hasSessionHint(`a=1; ${SESSION_HINT_COOKIE}=1; b=2`)).toBe(true);
    expect(hasSessionHint(`${SESSION_HINT_COOKIE}=0`)).toBe(false);
    expect(hasSessionHint(`x${SESSION_HINT_COOKIE}=1`)).toBe(false);
    expect(hasSessionHint('')).toBe(false);
    expect(hasSessionHint(null)).toBe(false);
  });

  it('домен: свой → язык → атрибуция; пусто — без домена (только хост кабинета)', () => {
    expect(sessionHintDomain({ SESSION_HINT_COOKIE_DOMAIN: '.a.test', LOCALE_COOKIE_DOMAIN: '.b.test' })).toBe('.a.test');
    expect(sessionHintDomain({ LOCALE_COOKIE_DOMAIN: ' .b.test ' })).toBe('.b.test');
    expect(sessionHintDomain({ ATTRIBUTION_COOKIE_DOMAIN: '.c.test' })).toBe('.c.test');
    expect(sessionHintDomain({})).toBeUndefined();
  });
});
