import { describe, expect, it } from 'vitest';
import { checkReturnUrl, safeLaunchNext, terminalLaunchHref, terminalOrigins } from './launch';

/** Правила входа верхним уровнем: белый список, продолжение после логина, кнопки. */

describe('белый список origin терминала', () => {
  it('через пробел/запятую, нормализуется до origin, мусор отброшен', () => {
    expect(
      terminalOrigins({ TERMINAL_ORIGINS: 'https://t.example.com/app, https://t2.example.com  not-a-url' } as unknown as NodeJS.ProcessEnv),
    ).toEqual(['https://t.example.com', 'https://t2.example.com']);
  });
  it('по умолчанию — origin NEXT_PUBLIC_TERMINAL_URL; ничего — пусто (всё отвергается)', () => {
    expect(terminalOrigins({ NEXT_PUBLIC_TERMINAL_URL: 'https://t.example.com/x' } as unknown as NodeJS.ProcessEnv)).toEqual([
      'https://t.example.com',
    ]);
    expect(terminalOrigins({} as unknown as NodeJS.ProcessEnv)).toEqual([]);
    expect(checkReturnUrl('https://t.example.com/', [])).toBeNull();
  });
  it('фрагмент возврата отбрасывается', () => {
    expect(checkReturnUrl('https://t.example.com/?site=a#x=1', ['https://t.example.com'])).toBe('https://t.example.com/?site=a');
  });
});

describe('продолжение после логина — только сам launch', () => {
  it.each([
    ['/api/sso/launch?account=demo&return=https%3A%2F%2Ft', '/api/sso/launch?account=demo&return=https%3A%2F%2Ft'],
    ['https://evil.example/api/sso/launch?x=1', null],
    ['//evil.example/api/sso/launch?x', null],
    ['/api/sso/launch/../../evil?x', null],
    ['/\\evil.example', null],
    ['/', null],
    [undefined, null],
  ])('%s', (raw, want) => {
    expect(safeLaunchNext(raw)).toBe(want);
  });
});

describe('кнопки «Торговать»', () => {
  const env = {
    TERMINAL_TOP_LEVEL: '1',
    NEXT_PUBLIC_TERMINAL_URL: 'https://t.example.com',
    SITE_SLUG: 'apex-ru',
  } as unknown as NodeJS.ProcessEnv;
  it('флаг включён — launch с return=<terminal>/?site=<slug> и языком', () => {
    const href = terminalLaunchHref('real', 'en', env)!;
    const q = new URLSearchParams(href.split('?').slice(1).join('?'));
    expect(href.startsWith('/api/sso/launch?')).toBe(true);
    expect(q.get('account')).toBe('real');
    expect(q.get('return')).toBe('https://t.example.com/?site=apex-ru');
    expect(q.get('lang')).toBe('en');
  });
  it('без флага или без адреса терминала — прежний путь (null)', () => {
    expect(terminalLaunchHref('demo', 'ru', { ...env, TERMINAL_TOP_LEVEL: '' })).toBeNull();
    expect(terminalLaunchHref('demo', 'ru', { ...env, NEXT_PUBLIC_TERMINAL_URL: '' })).toBeNull();
  });
});
