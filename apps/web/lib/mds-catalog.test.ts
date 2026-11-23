import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const WEB = path.resolve(__dirname, '..');
const read = (relative: string) => readFileSync(path.join(WEB, relative), 'utf8');

const code = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const MARKETING_LAYOUT = 'app/[locale]/(marketing)/layout.tsx';
const CATALOG_ROUTE = 'app/api/quotes/catalog/route.ts';

describe('getMdsCatalog · отказ назван причиной', () => {
beforeAll(async () => {
  await import('./mds');
});

  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('переменной нет → not-configured, и в сеть не ходим', async () => {
    vi.stubEnv('MDS_HTTP_URL', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { getMdsCatalog } = await import('./mds');

    expect(await getMdsCatalog()).toEqual({ state: 'unavailable', reason: 'not-configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('MDS ответил не-2xx → http-error: ответил, но не тем', async () => {
    vi.stubEnv('MDS_HTTP_URL', 'http://mds.test');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 503 }))));
    const { getMdsCatalog } = await import('./mds');

    expect(await getMdsCatalog()).toEqual({ state: 'unavailable', reason: 'http-error' });
  });

  it('MDS не отвечает вовсе → network, а не пустой каталог', async () => {
    vi.stubEnv('MDS_HTTP_URL', 'http://mds.test');
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))));
    const { getMdsCatalog } = await import('./mds');

    expect(await getMdsCatalog()).toEqual({ state: 'unavailable', reason: 'network' });
  });

  it('ответ 2xx с нечитаемым телом → malformed, а НЕ network', async () => {
    vi.stubEnv('MDS_HTTP_URL', 'http://mds.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response('не json', { status: 200, headers: { 'content-type': 'application/json' } })),
      ),
    );
    const { getMdsCatalog } = await import('./mds');

    expect(await getMdsCatalog()).toEqual({ state: 'unavailable', reason: 'malformed' });
  });

  it('в ответе нет поля items → malformed: мы не поняли ответ, а не узнали пустоту', async () => {
    vi.stubEnv('MDS_HTTP_URL', 'http://mds.test');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ error: 'nope' }))));
    const { getMdsCatalog } = await import('./mds');

    expect(await getMdsCatalog()).toEqual({ state: 'unavailable', reason: 'malformed' });
  });

  it('MDS ответил пустым списком → empty, и это ОТДЕЛЬНАЯ причина', async () => {
    vi.stubEnv('MDS_HTTP_URL', 'http://mds.test');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ items: [] }))));
    const { getMdsCatalog } = await import('./mds');

    expect(await getMdsCatalog()).toEqual({ state: 'unavailable', reason: 'empty' });
  });

  it('символы есть → available с набором', async () => {
    vi.stubEnv('MDS_HTTP_URL', 'http://mds.test/');
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(Response.json({ items: [{ symbol: 'EURUSD' }, { symbol: 'BTCUSD' }, {}] })),
      ),
    );
    const { getMdsCatalog } = await import('./mds');

    const catalog = await getMdsCatalog();
    expect(catalog.state).toBe('available');
    expect(catalog.state === 'available' && [...catalog.symbols]).toEqual(['EURUSD', 'BTCUSD']);
  });

  it('редакционное окно переиспользования ответа ПЕРЕЖИЛО починку', async () => {
    vi.stubEnv('MDS_HTTP_URL', 'http://mds.test');
    const mock = vi.fn(() => Promise.resolve(Response.json({ items: [{ symbol: 'EURUSD' }] })));
    vi.stubGlobal('fetch', mock);
    const { getMdsCatalog } = await import('./mds');

    await getMdsCatalog();

    const init = (mock.mock.calls[0] as unknown[])[1] as { next?: { revalidate?: number } };
    expect(init.next?.revalidate).toBe(300);
  });
});

describe('отказ оставляет след, и след не захламляет лог', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function load() {
    const mod = await import('./mds');
    mod.__resetCatalogLogState();
    return mod;
  }

  it('отказ называет причину РАЗЛИЧЁННО, а не «что-то с MDS»', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('MDS_HTTP_URL', 'http://mds.test');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 503 }))));
    const { getMdsCatalog } = await load();

    await getMdsCatalog();

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('http-error');
  });

  it('повтор того же отказа НЕ пишется второй раз', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('MDS_HTTP_URL', 'http://mds.test');
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))));
    const { getMdsCatalog } = await load();

    await getMdsCatalog();
    await getMdsCatalog();
    await getMdsCatalog();

    expect(error).toHaveBeenCalledTimes(1);
  });

  it('СМЕНА причины пишется: это другая неполадка', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('MDS_HTTP_URL', 'http://mds.test');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);
    const { getMdsCatalog } = await load();

    await getMdsCatalog();
    await getMdsCatalog();

    expect(error).toHaveBeenCalledTimes(2);
    expect(String(error.mock.calls[0]?.[0])).toContain('http-error');
    expect(String(error.mock.calls[1]?.[0])).toContain('network');
  });

  it('восстановление называет ЧИСЛО повторов — иначе «сколько длилось» неизвестно', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('MDS_HTTP_URL', 'http://mds.test');
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(Response.json({ items: [{ symbol: 'EURUSD' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const { getMdsCatalog } = await load();

    await getMdsCatalog();
    await getMdsCatalog();
    await getMdsCatalog();
    await getMdsCatalog();

    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]?.[0]);
    expect(line).toContain('network');
    expect(line).toContain('2');
  });

  it('штатная работа молчит: лог не ведёт дневник успехов', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubEnv('MDS_HTTP_URL', 'http://mds.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ items: [{ symbol: 'EURUSD' }] }))),
    );
    const { getMdsCatalog } = await load();

    await getMdsCatalog();
    await getMdsCatalog();

    expect(error).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
  });
});

describe('проводка каталога по сегментам витрины', () => {
  it('общий макет каталог НЕ спрашивает — на сборке переменной нет', () => {
    const layout = code(MARKETING_LAYOUT);

    expect(layout).not.toContain('getMdsCatalog');
    expect(layout).not.toContain('getMdsSymbols');
    expect(layout).not.toContain('TickerGate');
  });

  it('зашитого списка символов на витрине не осталось НИГДЕ', () => {
    const doors = [
      MARKETING_LAYOUT,
      'features/quotes/ticker-decision.ts',
      'features/hero-backdrop/backdrop-symbols.ts',
    ];

    for (const file of doors) {
      expect(code(file)).not.toContain('DEFAULT_TICKER_SYMBOLS');
    }
  });

  it('фон главной спрашивает ОБЕ рантаймовые ручки', () => {
    const backdrop = code('features/hero-backdrop/backdrop-symbols.ts');

    expect(backdrop).toContain("'/api/quotes/catalog'");
    expect(backdrop).toContain("'/api/tenant/access'");
  });

  it('ручка каталога объявлена динамической — GET без неё пререндерится', () => {
    expect(code(CATALOG_ROUTE)).toContain("export const dynamic = 'force-dynamic'");
  });
});
