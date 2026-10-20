import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WEB-08 / Р-050: каталог MDS читается в РАНТАЙМЕ, и его отсутствие
 * названо причиной, а не склеено в одно «пусто».
 *
 * Два разных предмета проверки, и их нельзя путать:
 *
 *  1. **Адаптер** — что возвращает `getMdsCatalog()` при каждом виде
 *     отказа. Прежняя `getMdsSymbols()` на все три отвечала `null`.
 *  2. **Проводка** — ОТКУДА его зовут. Дефект жил не в функции, а в
 *     том, что её звали из сегмента, который рендерится на сборке.
 *     Класс «вызывается не там» модульными тестами не ловится в
 *     принципе: функция-то исправна. Поэтому проводка закреплена
 *     отдельно и проверяется по тексту файлов.
 */

const WEB = path.resolve(__dirname, '..');
const read = (relative: string) => readFileSync(path.join(WEB, relative), 'utf8');

/**
 * Код без комментариев: объяснение, почему вызова здесь НЕТ, обязано
 * лежать рядом с кодом и называть функцию по имени — иначе пришлось бы
 * выбирать между проверяемым правилом и записанным намерением.
 */
const code = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const MARKETING_LAYOUT = 'app/[locale]/(marketing)/layout.tsx';
const CATALOG_ROUTE = 'app/api/quotes/catalog/route.ts';

/* ------------------------------------------------------------------ */
/* 1. Адаптер: три причины отказа, и ни одна не выглядит разрешением    */
/* ------------------------------------------------------------------ */

describe('getMdsCatalog · отказ назван причиной', () => {
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
    // Ровно состояние сборки — то, в котором дефект и жил.
    vi.stubEnv('MDS_HTTP_URL', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { getMdsCatalog } = await import('./mds');

    expect(await getMdsCatalog()).toEqual({ state: 'unavailable', reason: 'not-configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('MDS ответил не-2xx → http-error: ответил, но не тем', async () => {
    // «Не дозвонились» и «дозвонились, ответил не-2xx» чинят разные
    // люди: первое сеть, второе сосед. Схлопнутые — отправляют чинить
    // наугад (Р-070).
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
    // Разбор тела стоит в своём `try`. Иначе нечитаемый JSON улетал бы
    // во внешний catch и назывался бы «не дозвонились» — при том, что
    // дозвонились. Глушитель, поставленный ради ожидаемой сетевой
    // ошибки, глотает и ошибку формы ответа.
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
    // Разбор и приведение — разные барьеры. Ответ без `items`
    // разбирается как JSON успешно, и прежний `data.items ?? null`
    // превращал непонятый ответ в «каталог пуст».
    vi.stubEnv('MDS_HTTP_URL', 'http://mds.test');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ error: 'nope' }))));
    const { getMdsCatalog } = await import('./mds');

    expect(await getMdsCatalog()).toEqual({ state: 'unavailable', reason: 'malformed' });
  });

  it('MDS ответил пустым списком → empty, и это ОТДЕЛЬНАЯ причина', async () => {
    // «Сосед сказал: ничего не транслируется» и «мы не смогли спросить»
    // чинят разные люди. Склеенные в один счётчик, они начинают
    // противоречить сами себе.
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
    // Растяжка. Чинился источник значения, а не частота его обновления;
    // `cache: 'no-store'` снёс бы окно заодно — починка ценой свойства,
    // которое не ломалось.
    vi.stubEnv('MDS_HTTP_URL', 'http://mds.test');
    const mock = vi.fn(() => Promise.resolve(Response.json({ items: [{ symbol: 'EURUSD' }] })));
    vi.stubGlobal('fetch', mock);
    const { getMdsCatalog } = await import('./mds');

    await getMdsCatalog();

    const init = (mock.mock.calls[0] as unknown[])[1] as { next?: { revalidate?: number } };
    expect(init.next?.revalidate).toBe(300);
  });
});

/* ------------------------------------------------------------------ */
/* 1б. След отказа: на смене состояния, а не на каждый тик (Р-070)      */
/* ------------------------------------------------------------------ */

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
    // Поток одинаковых строк перестают читать так же быстро, как
    // молчание, и настоящая смена причины в нём тонет.
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
    // Два повтора после первой записи.
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
    // Первый успех — это тоже смена состояния с «неизвестно», и он
    // пишется один раз. Второй уже молчит.
    expect(info).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Проводка: кто спрашивает каталог и из какого сегмента             */
/* ------------------------------------------------------------------ */

describe('проводка каталога по сегментам витрины', () => {
  it('общий макет каталог НЕ спрашивает — на сборке переменной нет', () => {
    // Это и был дефект Р-050. Проявлялся он не падением, а подменой
    // содержимого строки, и обычным тестом не ловится вовсе.
    const layout = code(MARKETING_LAYOUT);

    expect(layout).not.toContain('getMdsCatalog');
    expect(layout).not.toContain('getMdsSymbols');
    expect(layout).toContain('<TickerGate');
  });

  it('зашитого списка символов на витрине не осталось НИГДЕ', () => {
    // Умолчание убирается из всех дверей сразу, иначе вернётся через
    // оставшуюся: у `QuotesTicker` оно стояло вторым, в значении пропа.
    const doors = [
      MARKETING_LAYOUT,
      'features/quotes/TickerGate.tsx',
      'features/quotes/QuotesTicker.tsx',
      'features/quotes/ticker-decision.ts',
    ];

    for (const file of doors) {
      expect(code(file)).not.toContain('DEFAULT_TICKER_SYMBOLS');
    }
  });

  it('островок спрашивает ОБЕ рантаймовые ручки', () => {
    // Снятие вопроса не красит ни одного обычного теста: ссылка без
    // записи в проводке не видна ни типам, ни линтеру.
    const gate = code('features/quotes/TickerGate.tsx');

    expect(gate).toContain("'/api/quotes/catalog'");
    expect(gate).toContain("'/api/tenant/access'");
    expect(gate).toContain("'use client'");
  });

  it('ручка каталога объявлена динамической — GET без неё пререндерится', () => {
    // Тот же дефект, что B-010 у `/api/health`: статический GET отдавал
    // бы ответ сборки под видом ответа рантайма, и починка свелась бы к
    // переносу той же лжи на один файл правее.
    expect(code(CATALOG_ROUTE)).toContain("export const dynamic = 'force-dynamic'");
  });
});
