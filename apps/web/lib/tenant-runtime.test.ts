import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WEB = path.resolve(__dirname, '..');
const read = (relative: string) => readFileSync(path.join(WEB, relative), 'utf8');

const code = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const MARKETING_LAYOUT = 'app/[locale]/(marketing)/layout.tsx';
const ACCESS_ROUTE = 'app/api/tenant/access/route.ts';
const INSTRUMENTS_PAGE = 'app/[locale]/(marketing)/instruments/page.tsx';
const DETAIL_PAGE = 'app/[locale]/(marketing)/instruments/[category]/[symbol]/page.tsx';

const noStore = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ unstable_noStore: noStore }));

describe('getTenantAccess · рантайм, а не сборка', () => {
  beforeEach(() => {
    noStore.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('SITE_SLUG', 'apex-ru');
    vi.stubEnv('CMS_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('помечает рендер рантаймовым — иначе причина выводится из условий сборки', async () => {
    vi.stubEnv('CMS_API_URL', 'http://cms.test');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ instruments: ['BTCUSD'] }))));
    const { getTenantAccess } = await import('./tenant');

    await getTenantAccess();

    expect(noStore).toHaveBeenCalled();
  });

  it('помечает ДО того, как узнает, что CMS не настроена', async () => {
    vi.stubEnv('CMS_API_URL', '');
    const { getTenantAccess } = await import('./tenant');

    const access = await getTenantAccess();

    expect(access).toEqual({ state: 'unavailable', reason: 'not-configured' });
    expect(noStore).toHaveBeenCalled();
  });

  it('пометка стоит раньше запроса к CMS, а не после него', async () => {
    const order: string[] = [];
    noStore.mockImplementation(() => order.push('noStore'));
    vi.stubEnv('CMS_API_URL', 'http://cms.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        order.push('fetch');
        return Promise.resolve(Response.json({ instruments: ['BTCUSD'] }));
      }),
    );
    const { getTenantAccess } = await import('./tenant');

    await getTenantAccess();

    expect(order).toEqual(['noStore', 'fetch']);
  });

  it('редакционное окно и теги вебхука ПЕРЕЖИЛИ починку', async () => {
    vi.stubEnv('CMS_API_URL', 'http://cms.test');
    const mock = vi.fn(() => Promise.resolve(Response.json({ instruments: ['BTCUSD'] })));
    vi.stubGlobal('fetch', mock);
    const { getTenantAccess } = await import('./tenant');

    await getTenantAccess();

    const init = (mock.mock.calls[0] as unknown[])[1] as {
      cache?: string;
      next?: { tags?: string[]; revalidate?: number };
    };
    expect(init.next?.tags).toEqual(['cms:brand', 'cms:brand:apex-ru']);
    expect(init.next?.revalidate).toBe(300);
    expect(init.cache).toBeUndefined();
  });
});

describe('проводка границы по сегментам витрины', () => {
  it('общий макет границу НЕ спрашивает — иначе статики не остаётся вовсе', () => {
    const layout = code(MARKETING_LAYOUT);

    expect(layout).not.toContain('getTenantAccess');
    expect(layout).not.toContain('TickerGate');
  });

  it('фон главной спрашивает границу у рантаймовой ручки', () => {
    const backdrop = code('features/hero-backdrop/backdrop-symbols.ts');

    expect(backdrop).toContain("'/api/tenant/access'");
    expect(backdrop).toContain('fetch(');
  });

  it('ручка границы объявлена динамической — GET без неё пререндерится', () => {
    expect(code(ACCESS_ROUTE)).toContain("export const dynamic = 'force-dynamic'");
  });

  it('страницы инструментов спрашивают границу НА СЕРВЕРЕ, а не в браузере', () => {
    for (const page of [INSTRUMENTS_PAGE, DETAIL_PAGE]) {
      expect(code(page)).toContain('getTenantAccess');
    }
  });
});
