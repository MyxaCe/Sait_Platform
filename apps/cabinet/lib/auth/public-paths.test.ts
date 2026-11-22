import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import middleware from '../../middleware';
import { homePathFor, isMailLinkPath, isPublicAuthPath, loginPathFor } from './public-paths';
import { SESSION_COOKIE } from './constants';
import { resetSiteLanguagesCache } from '../site-languages-edge';

vi.mock('next-intl/middleware', () => ({ default: () => () => NextResponse.next() }));

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
      '/de/login',
      '/fr/register',
      '/es/forgot-password',
    ]) {
      expect(isPublicAuthPath(p), p).toBe(true);
    }
  });

  it('похожие и защищённые пути — не публичные', () => {
    for (const p of ['/', '/en', '/ru', '/wallet', '/en/wallet', '/loginx', '/xx/login', '/enlogin', '/ru/forgot-passwordx']) {
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

  it('язык сайта по умолчанию — de: он без префикса, ru — с префиксом', () => {
    const site = { languages: ['de', 'ru'] as const, defaultLanguage: 'de' as const };
    expect(loginPathFor('/wallet', site)).toBe('/login');
    expect(loginPathFor('/ru/wallet', site)).toBe('/ru/login');
    expect(homePathFor('/de/login', site)).toBe('/');
    expect(homePathFor('/ru/login', site)).toBe('/ru');
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

function siteCard(card: unknown) {
  vi.stubEnv('CMS_API_URL', 'http://cms.test/v1');
  vi.stubEnv('SITE_SLUG', 'demo');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(card), { status: 200 })));
}

beforeEach(() => resetSiteLanguagesCache());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('middleware: гость и вошедший', () => {
  it('гость на /ru/forgot-password и /en/forgot-password — НЕ уводится на вход', async () => {
    for (const p of ['/ru/forgot-password', '/en/forgot-password', '/forgot-password', '/ru/register']) {
      expect(location(await middleware(req(p))) ?? '(без редиректа)', p).not.toMatch(/\/login$/);
    }
  });

  it('гость на защищённой странице — на вход своего языка', async () => {
    expect(location(await middleware(req('/wallet')))).toBe('/login');
    expect(location(await middleware(req('/ru/wallet')))).toBe('/login');
    expect(location(await middleware(req('/en/wallet')))).toBe('/en/login');
  });

  it('вошедший на /ru/login — на главную, ссылка из письма открывается и вошедшему', async () => {
    expect(location(await middleware(req('/ru/login', true)))).toBe('/');
    expect(location(await middleware(req('/en/login', true)))).toBe('/en');
    expect(location(await middleware(req('/ru/reset-password', true)))).not.toBe('/');
  });
});

describe('middleware: языки сайта из CMS', () => {
  it('старая CMS без полей — de не включён: без редиректа на вход (страница ответит 404)', async () => {
    siteCard({ name: 'x' });
    expect(location(await middleware(req('/de/wallet')))).toBeNull();
    expect(location(await middleware(req('/en/wallet')))).toBe('/en/login');
  });

  it('включённые de/fr: вход своего языка, язык по умолчанию — без префикса', async () => {
    siteCard({ languages: ['fr', 'de', 'ru'], defaultLanguage: 'fr' });
    expect(location(await middleware(req('/de/wallet')))).toBe('/de/login');
    expect(location(await middleware(req('/wallet')))).toBe('/login');
    expect(location(await middleware(req('/ru/login', true)))).toBe('/ru');
    expect(location(await middleware(req('/es/wallet')))).toBeNull();
  });

  it('открытая страница ставит NEXT_LOCALE с языком пути', async () => {
    siteCard({ languages: ['ru', 'en', 'de'], defaultLanguage: 'ru' });
    const res = await middleware(req('/de/login'));
    expect(res.cookies.get('NEXT_LOCALE')?.value).toBe('de');
    const home = await middleware(req('/login'));
    expect(home.cookies.get('NEXT_LOCALE')?.value).toBe('ru');
  });
});
