import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WEB-12 · состояние котировок читается в РАНТАЙМЕ, и две оси причин не
 * смешиваются (Р-074, §4г).
 *
 * Снаружи ось канала — почему мы вообще не получили ответа. Внутри ось
 * символа — почему нет цены у конкретного инструмента; её называет MDS.
 * Схлопнутые, они отправляют чинить наугад: «сеть легла» и «у одного
 * символа молчит источник» — разные неполадки у разных людей.
 *
 * Проводка проверяется отдельно и по тексту: класс «функция исправна, но
 * зовётся не оттуда» модульным тестом не ловится в принципе — ровно на
 * этом погорел каталог (WEB-08).
 */

const WEB = path.resolve(__dirname, '..');
const read = (relative: string) => readFileSync(path.join(WEB, relative), 'utf8');

/**
 * Код без комментариев. Обязательно: мои же комментарии называют
 * `staleSymbols` по имени, и проверка по сырому тексту осталась бы зелёной
 * после того, как проводку сняли, а объяснение забыли стереть.
 */
const code = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('getMdsQuotesState · ось канала', () => {
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
    // Дозвонились и ответ получили — назвать это «не дозвонились» значит
    // отправить чинить сеть вместо контракта. Разбор тела стоит в своём
    // `try` именно поэтому.
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
    // «Источник ничего не сказал» — законный ответ, и он НЕ значит «всё
    // свежо». Назвать его отказом канала было бы так же неверно, как
    // прочитать его как разрешение.
    answer({ unavailable: [], missing: [] });
    const { getMdsQuotesState } = await import('./mds');

    expect(await getMdsQuotesState()).toEqual({
      state: 'available',
      quotes: { unavailable: [], missing: [] },
    });
  });

  it('незнакомое имя причины сохраняется, а не теряется', async () => {
    // На 20.10 §4 контракта показывает те же причины через подчёркивание,
    // а §4г объявляет нормой дефис и говорит, что MDS переименовывает
    // сейчас. Если старое написание доедет до нас, символ обязан остаться
    // недоступным, а рассинхрон — стать видимым.
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
    // Тот же класс дефекта, что у каталога (WEB-08): функция исправна, но
    // вызвана из сегмента, который рендерится на сборке.
    expect(read('app/api/quotes/state/route.ts')).toContain("dynamic = 'force-dynamic'");
  });

  it('состояние котировок не кешируется, в отличие от каталога', () => {
    // Каталогу окно в 300 с уместно, состоянию котировок — нет: ровно
    // замороженный ответ и есть дефект, против которого написан §5б.
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
    // Мутация «снять проводку» не красит ни один поведенческий тест:
    // островок продолжает отвечать, лента продолжает рисоваться, просто
    // список никуда не едет. Прочитать и не применить — ровно тот исход,
    // против которого заведена WEB-12, поэтому проводка закреплена здесь.
    expect(code('features/quotes/TickerGate.tsx')).toMatch(/<QuotesTicker[^>]*staleSymbols=/s);
  });

  it('лента отдаёт список вердикту, а не держит его в пропсах', () => {
    // Вторая половина той же проводки: принять проп и не передать его в
    // `quoteState` — такой же молчаливый разрыв.
    expect(code('features/quotes/QuotesTicker.tsx')).toMatch(/useQuoteViews\([^)]*staleSymbols/s);
  });
});
