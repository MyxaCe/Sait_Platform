import { describe, expect, it } from 'vitest';
import { EXPIRED_PATH, expiredHref, loginAfterExpiry } from './expired';

describe('погашенная сессия: путь через обработчик, без петли / ↔ /login (ТД-009 п.4)', () => {
  it('ведёт на обработчик под /api (middleware его не трогает)', () => {
    expect(EXPIRED_PATH.startsWith('/api/')).toBe(true);
    expect(expiredHref('en')).toBe('/api/auth/expired?locale=en');
  });

  it('сохраняет next, чтобы после входа вернуться в терминал с символом', () => {
    const href = expiredHref('ru', '/terminal?account=real&symbol=EURUSD');
    expect(new URL(href, 'https://x.test').searchParams.get('next')).toBe('/terminal?account=real&symbol=EURUSD');
  });

  it('после стирания cookie — на вход с next', () => {
    expect(loginAfterExpiry('/en/login', '/terminal?account=demo')).toBe('/en/login?next=%2Fterminal%3Faccount%3Ddemo');
    expect(loginAfterExpiry('/login', null)).toBe('/login');
  });
});
