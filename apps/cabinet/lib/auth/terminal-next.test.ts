import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import middleware from '../../middleware';
import { SESSION_COOKIE } from './constants';
import { safeNext, withNext } from './next-path';
import { parseTerminalSymbol, safeTerminalNext } from './public-paths';
import { terminalLaunchHref } from '../sso/launch';
import { resetSiteLanguagesCache } from '../site-languages-edge';

vi.mock('next-intl/middleware', () => ({ default: () => () => NextResponse.next() }));

beforeEach(() => resetSiteLanguagesCache());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('символ инструмента для терминала', () => {
  it.each([
    ['BTCUSD', 'BTCUSD'],
    ['eurusd', 'EURUSD'],
    ['US500', 'US500'],
    ['BTC-USDT', null],
    ['<script>', null],
    ['', null],
    [undefined, null],
  ])('%s → %s', (raw, want) => {
    expect(parseTerminalSymbol(raw)).toBe(want);
  });
});

describe('возврат после входа на терминал с инструментом', () => {
  it.each([
    ['/terminal?account=real&symbol=BTCUSD', '/terminal?account=real&symbol=BTCUSD'],
    ['/en/terminal?account=demo&symbol=xauusd', '/en/terminal?account=demo&symbol=XAUUSD'],
    ['/terminal?account=real&symbol=BTCUSD&evil=1', '/terminal?account=real&symbol=BTCUSD'],
    ['/terminal?account=root&symbol=..%2F', '/terminal'],
    ['/terminal', '/terminal'],
    ['/wallet', null],
    ['//evil.example/terminal', null],
    ['https://evil.example/terminal', null],
    ['/\evil.example/terminal', null],
    ['/terminal/../wallet', null],
  ])('%s → %s', (raw, want) => {
    expect(safeTerminalNext(raw)).toBe(want);
  });

  it('продолжение launch по-прежнему принимается', () => {
    expect(safeNext('/api/sso/launch?account=demo&return=x')).toBe('/api/sso/launch?account=demo&return=x');
  });

  it('ссылка между входом и регистрацией несёт продолжение', () => {
    expect(withNext('/register', '/en/terminal?account=real&symbol=BTCUSD')).toBe(
      '/register?next=%2Fen%2Fterminal%3Faccount%3Dreal%26symbol%3DBTCUSD',
    );
    expect(withNext('/register', null)).toBe('/register');
  });
});

describe('middleware: гость на терминале уходит на вход с возвратом', () => {
  const req = (path: string, withSession = false) => {
    const r = new NextRequest(new URL(path, 'http://cabinet.test'));
    if (withSession) r.cookies.set(SESSION_COOKIE, 'x');
    return r;
  };

  it('терминал с инструментом → /login?next=… того же адреса', async () => {
    const res = await middleware(req('/en/terminal?account=real&symbol=BTCUSD'));
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/en/login');
    expect(loc.searchParams.get('next')).toBe('/en/terminal?account=real&symbol=BTCUSD');
  });

  it('прочие страницы — без продолжения, как раньше', async () => {
    const loc = new URL((await middleware(req('/wallet'))).headers.get('location')!);
    expect(loc.pathname).toBe('/login');
    expect(loc.search).toBe('');
  });
});

describe('вход в терминал верхним уровнем передаёт инструмент', () => {
  const env = {
    TERMINAL_TOP_LEVEL: '1',
    NEXT_PUBLIC_TERMINAL_URL: 'https://t.example.com',
    SITE_SLUG: 'apex-ru',
  } as unknown as NodeJS.ProcessEnv;

  it('symbol уходит в адрес возврата терминала', () => {
    const href = terminalLaunchHref('real', 'ru', env, 'BTCUSD')!;
    const q = new URLSearchParams(href.split('?').slice(1).join('?'));
    expect(q.get('return')).toBe('https://t.example.com/?site=apex-ru&symbol=BTCUSD');
  });

  it('без символа адрес прежний', () => {
    const href = terminalLaunchHref('demo', 'ru', env)!;
    const q = new URLSearchParams(href.split('?').slice(1).join('?'));
    expect(q.get('return')).toBe('https://t.example.com/?site=apex-ru');
  });
});
