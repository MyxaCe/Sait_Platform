import { describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import middleware from '../../middleware';
import { homePathFor, isMailLinkPath, isPublicAuthPath, loginPathFor } from './public-paths';
import { SESSION_COOKIE } from './constants';

// Middleware next-intl (ESM-импорт `next/server`) в node-прогоне не грузится —
// подменяем пропуском: проверяем НАШ гейт до него.
vi.mock('next-intl/middleware', () => ({ default: () => () => NextResponse.next() }));

/**
 * Публичные страницы входа с ЛЮБЫМ префиксом локали (волна 3): `/ru/forgot-password`
 * без сессии уводил на /login — регулярка знала только `/en`.
 */
describe('классификация путей', () => {
  it('вход/регистрация/восстановление — с префиксом ru, en и без него', () => {
    for (const p of [
      '/login',
      '/register',
      '/forgot-password',
      '/ru/login',
      '/ru/register',
      '/ru/forgot-password',
      '/en/login',
      '/en/forgot-password',
      '/en/register/',
    ]) {
      expect(isPublicAuthPath(p), p).toBe(true);
    }
  });

  it('похожие и защищённые пути — не публичные', () => {
    for (const p of ['/', '/en', '/ru', '/wallet', '/en/wallet', '/loginx', '/de/login', '/enlogin', '/ru/forgot-passwordx']) {
      expect(isPublicAuthPath(p), p).toBe(false);
    }
  });

  it('ссылки из писем — с любым префиксом', () => {
    for (const p of ['/reset-password', '/ru/reset-password', '/en/verify-email', '/verify-email/abc']) {
      expect(isMailLinkPath(p), p).toBe(true);
    }
    expect(isMailLinkPath('/ru/wallet')).toBe(false);
  });

  it('куда вести: язык пути сохраняется, по умолчанию — без префикса', () => {
    expect(loginPathFor('/ru/wallet')).toBe('/login');
    expect(loginPathFor('/wallet')).toBe('/login');
    expect(loginPathFor('/en/wallet')).toBe('/en/login');
    expect(loginPathFor('/en')).toBe('/en/login');
    expect(homePathFor('/ru/login')).toBe('/');
    expect(homePathFor('/en/login')).toBe('/en');
  });
});

function req(path: string, withSession = false): NextRequest {
  const r = new NextRequest(new URL(path, 'http://cabinet.test'));
  if (withSession) r.cookies.set(SESSION_COOKIE, 'x');
  return r;
}

function location(res: Response): string | null {
  const loc = res.headers.get('location');
  return loc ? new URL(loc).pathname : null;
}

describe('middleware: гость и вошедший', () => {
  it('гость на /ru/forgot-password и /en/forgot-password — НЕ уводится на вход', () => {
    for (const p of ['/ru/forgot-password', '/en/forgot-password', '/forgot-password', '/ru/register']) {
      expect(location(middleware(req(p))) ?? '(без редиректа)', p).not.toMatch(/\/login$/);
    }
  });

  it('гость на защищённой странице — на вход своего языка', () => {
    expect(location(middleware(req('/wallet')))).toBe('/login');
    expect(location(middleware(req('/ru/wallet')))).toBe('/login');
    expect(location(middleware(req('/en/wallet')))).toBe('/en/login');
  });

  it('вошедший на /ru/login — на главную, ссылка из письма открывается и вошедшему', () => {
    expect(location(middleware(req('/ru/login', true)))).toBe('/');
    expect(location(middleware(req('/en/login', true)))).toBe('/en');
    expect(location(middleware(req('/ru/reset-password', true)))).not.toBe('/');
  });
});
