import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const WEB = path.resolve(__dirname, '..');
const read = (relative: string) => readFileSync(path.join(WEB, relative), 'utf8');

const code = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('getMdsQuotesState · ось канала', () => {
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
    const { getMdsQuotesState } = await import('./mds');

    expect(await getMdsQuotesState()).toEqual({ state: 'unavailable', reason: 'not-configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('не-2xx → http-error, а не пустое состояние', async () => {
    vi.stubEnv('MDS_HTTP_URL', 'http://mds.test');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 503 }))));
    const { getMdsQuotesState } = await import('./mds');

    expect(await getMdsQuotesState()).toEqual({ state: 'unavailable', reason: 'http-error' });
  });

  it('не дозвонились → network', async () => {
    vi.stubEnv('MDS_HTTP_URL', 'http://mds.test');
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))));
    const { getMdsQuotesState } = await import('./mds');

    expect(await getMdsQuotesState()).toEqual({ state: 'unavailable', reason: 'network' });
  });

  it('нечитаемое тело → malformed, а НЕ network', async () => {
    vi.stubEnv('MDS_HTTP_URL', 'http://mds.test');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('не json', { status: 200 }))));
    const { getMdsQuotesState } = await import('./mds');

    expect(await getMdsQuotesState()).toEqual({ state: 'unavailable', reason: 'malformed' });
  });
});

describe('getMdsQuotesState · ось символа', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('MDS_HTTP_URL', 'http://mds.test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const answer = (body: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );

  it('причина по каждому символу доезжает до вызывающего', async () => {
    answer({
      unavailable: [
        { symbol: 'EURUSD', reason: 'source-silent' },
        { symbol: 'XAUUSD', reason: 'stale' },
      ],
      missing: ['BTCUSD'],
    });
    const { getMdsQuotesState } = await import('./mds');

    const outcome = await getMdsQuotesState();

    expect(outcome).toEqual({
      state: 'available',
      quotes: {
        unavailable: [
          { symbol: 'EURUSD', reason: 'source-silent' },
          { symbol: 'XAUUSD', reason: 'stale' },
        ],
        missing: ['BTCUSD'],
      },
    });
  });

  it('пустые списки — это `available`, а не отказ', async () => {
    answer({ unavailable: [], missing: [] });
    const { getMdsQuotesState } = await import('./mds');

    expect(await getMdsQuotesState()).toEqual({
      state: 'available',
      quotes: { unavailable: [], missing: [] },
    });
  });

  it('незнакомое имя причины сохраняется, а не теряется', async () => {
    answer({ unavailable: [{ symbol: 'EURUSD', reason: 'source_silent' }], missing: [] });
    const { getMdsQuotesState } = await import('./mds');

    const outcome = await getMdsQuotesState();

    expect(outcome).toEqual({
      state: 'available',
      quotes: {
        unavailable: [{ symbol: 'EURUSD', reason: null, rawReason: 'source_silent' }],
        missing: [],
      },
    });
  });
});

describe('проводка · состояние котировок спрашивают из рантайма', () => {
  it('ручка объявлена динамической — иначе ответ замёрзнет на сборке', () => {
    expect(read('app/api/quotes/state/route.ts')).toContain("dynamic = 'force-dynamic'");
  });

  it('состояние котировок не кешируется, в отличие от каталога', () => {
    const mds = read('lib/mds.ts');
    const quotesCall = mds.slice(mds.indexOf('/v1/quotes'));

    expect(quotesCall).toContain("cache: 'no-store'");
    expect(quotesCall.slice(0, quotesCall.indexOf('}'))).not.toContain('revalidate');
  });

  it('островок спрашивает ручку сам, а макет — нет', () => {
    expect(read('features/quotes/TickerGate.tsx')).toContain('/api/quotes/state');
    expect(read('app/[locale]/(marketing)/layout.tsx')).not.toContain('/api/quotes/state');
  });

  it('прочитанный список ДОХОДИТ до ленты, а не оседает в островке', () => {
    expect(code('features/quotes/TickerGate.tsx')).toMatch(/<QuotesTicker[^>]*staleSymbols=/s);
  });

  it('лента отдаёт список вердикту, а не держит его в пропсах', () => {
    expect(code('features/quotes/QuotesTicker.tsx')).toMatch(/useQuoteViews\([^)]*staleSymbols/s);
  });
});
