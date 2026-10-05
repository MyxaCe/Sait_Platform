import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeNotice } from '@/features/home/markets-notice';
import { getMarketInstruments, type MarketsData } from './home';

/**
 * Модуль «Рынки»: откуда берутся данные и ПОЧЕМУ их может не быть (Р-025).
 *
 * До Р-025 на все причины был один ответ — пустой массив, — и модуль по
 * нему исчезал со страницы. Пять разных причин (граница пуста · граница
 * недоступна · MDS не настроен · MDS не ответил · ни одна вкладка не
 * включена) выглядели одинаково: отказ был неотличим от отсутствия
 * функции.
 *
 * Мутации, от которых набор обязан покраснеть (прогнаны, см. ADR-029):
 *   1. `getMarketInstruments` снова возвращает массив вместо размеченного
 *      результата → модуль нечем объяснить;
 *   2. закрытая граница трактуется как «полный каталог MDS»;
 *   3. каталог запрашивается до проверки границы и его отказ называется
 *      причиной вместо закрытой границы;
 *   4. `describeNotice` возвращает `null` для закрытого состояния —
 *      то есть модуль снова молча исчезает.
 */

const CMS = 'http://cms.test';
const MDS = 'http://mds.test';

const MDS_ITEMS = {
  items: [
    { symbol: 'BTCUSD', name: 'Bitcoin', digits: 2, icon: '/icons/BTCUSD.svg' },
    { symbol: 'ETHUSD', name: 'Ethereum', digits: 2, icon: null },
    { symbol: 'XAUUSD', name: 'Gold', digits: 2, icon: null },
  ],
};

interface Routes {
  cms?: () => Promise<Response>;
  mds?: () => Promise<Response>;
}

/** Один глобальный `fetch` обслуживает двух соседей — разводим по URL. */
function route({ cms, mds }: Routes) {
  const calls = { cms: 0, mds: 0 };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (String(url).includes('/cms/sites/')) {
        calls.cms += 1;
        return (cms ?? (() => Promise.resolve(Response.json({ instruments: [] }))))();
      }
      calls.mds += 1;
      return (mds ?? (() => Promise.resolve(Response.json(MDS_ITEMS))))();
    }),
  );
  return calls;
}

const allowList = (...symbols: string[]) => () =>
  Promise.resolve(Response.json({ instruments: symbols }));

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('CMS_API_URL', CMS);
  vi.stubEnv('MDS_HTTP_URL', MDS);
  vi.stubEnv('NEXT_PUBLIC_WS_URL', MDS);
  vi.stubEnv('SITE_SLUG', 'apex-ru');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* Состояние 1 — список непустой                                       */
/* ------------------------------------------------------------------ */

describe('список непустой', () => {
  it('каталог MDS пересекается с доступом, остальное отброшено', async () => {
    route({ cms: allowList('BTCUSD', 'ETHUSD') });

    const data = await getMarketInstruments();

    expect(data.state).toBe('ok');
    expect(data.state === 'ok' && data.instruments.map((i) => i.symbol)).toEqual([
      'BTCUSD',
      'ETHUSD',
    ]);
    expect(describeNotice(data, 2)).toBeNull(); // объяснять нечего
  });

  it('разрешённое, но не котируемое MDS → ok с пустым списком, и это СВОЯ причина', async () => {
    route({ cms: allowList('SOMETHING-ELSE') });

    const data = await getMarketInstruments();

    expect(data).toEqual({ state: 'ok', instruments: [] });
    // Не закрытая граница и не лежащий MDS — третья причина, со своим текстом
    expect(describeNotice(data, 2)?.titleKey).toBe('marketsNoMatchTitle');
  });
});

/* ------------------------------------------------------------------ */
/* Состояние 2 — список пуст                                           */
/* ------------------------------------------------------------------ */

describe('список пуст', () => {
  it('модуль не показывает ничего и говорит, что инструменты не выбраны', async () => {
    const calls = route({ cms: allowList() });

    const data = await getMarketInstruments();

    expect(data).toEqual({ state: 'access-empty' });
    expect(describeNotice(data, 2)?.titleKey).toBe('marketsClosedEmptyTitle');
    // Граница закрыта — состояние MDS на исход не влияет, и спрашивать
    // его незачем: иначе причиной назвали бы исправную деталь
    expect(calls.mds).toBe(0);
  });

  it('РАСТЯЖКА: пустой список НЕ превращается в полный каталог MDS', async () => {
    route({ cms: allowList() });

    const data = await getMarketInstruments();

    // Мутация «вернуть fail-open на пустом списке» красит этот тест:
    // ни один символ каталога не доезжает до модуля
    expect(data.state).not.toBe('ok');
  });
});

/* ------------------------------------------------------------------ */
/* Состояние 3 — CMS недоступна                                        */
/* ------------------------------------------------------------------ */

describe('CMS недоступна', () => {
  it('503 → access-unavailable:http-error, каталог не спрашиваем', async () => {
    const calls = route({ cms: () => Promise.resolve(new Response('', { status: 503 })) });

    const data = await getMarketInstruments();

    expect(data).toEqual({ state: 'access-unavailable', reason: 'http-error' });
    expect(calls.mds).toBe(0);
  });

  it('соединение отклонено → access-unavailable:network со своим текстом', async () => {
    route({ cms: () => Promise.reject(new Error('ECONNREFUSED')) });

    const data = await getMarketInstruments();

    expect(data).toEqual({ state: 'access-unavailable', reason: 'network' });
    const notice = describeNotice(data, 2);
    expect(notice?.titleKey).toBe('marketsClosedUnavailableTitle');
    expect(notice?.reason).toBe('network'); // причина видна на экране
  });

  it('«недоступно» и «пусто» дают РАЗНЫЕ объяснения при одинаковом запрете', async () => {
    route({ cms: allowList() });
    const empty = await getMarketInstruments();
    route({ cms: () => Promise.resolve(new Response('', { status: 500 })) });
    const down = await getMarketInstruments();

    expect(empty.state).not.toBe(down.state);
    expect(describeNotice(empty, 2)?.titleKey).not.toBe(describeNotice(down, 2)?.titleKey);
  });
});

/* ------------------------------------------------------------------ */
/* Граница открыта, но каталог недоступен — это НЕ то же самое         */
/* ------------------------------------------------------------------ */

describe('MDS недоступен при открытой границе', () => {
  it('MDS_HTTP_URL не задан → catalog-unavailable:not-configured', async () => {
    vi.stubEnv('MDS_HTTP_URL', '');
    route({ cms: allowList('BTCUSD') });

    const data = await getMarketInstruments();

    expect(data).toEqual({ state: 'catalog-unavailable', reason: 'not-configured' });
    expect(describeNotice(data, 2)?.titleKey).toBe('marketsCatalogTitle');
  });

  it('MDS ответил 500 → catalog-unavailable:http-error', async () => {
    route({ cms: allowList('BTCUSD'), mds: () => Promise.resolve(new Response('', { status: 500 })) });

    expect(await getMarketInstruments()).toEqual({
      state: 'catalog-unavailable',
      reason: 'http-error',
    });
  });

  it('MDS не отвечает → catalog-unavailable:network', async () => {
    route({ cms: allowList('BTCUSD'), mds: () => Promise.reject(new Error('ECONNREFUSED')) });

    expect(await getMarketInstruments()).toEqual({
      state: 'catalog-unavailable',
      reason: 'network',
    });
  });

  it('отказ каталога НЕ выдаётся за закрытую границу', async () => {
    route({ cms: allowList('BTCUSD'), mds: () => Promise.reject(new Error('ECONNREFUSED')) });

    const data = await getMarketInstruments();

    // Разные неисправности чинят разные люди: границу — редактор CMS,
    // каталог — владелец MDS. Склеив их, мы отправим чинить не туда.
    expect(data.state).not.toBe('access-unavailable');
    expect(describeNotice(data, 2)?.titleKey).not.toBe('marketsClosedUnavailableTitle');
  });
});

/* ------------------------------------------------------------------ */
/* Растяжки на сам механизм                                            */
/* ------------------------------------------------------------------ */

describe('модуль «Рынки» никогда не исчезает молча', () => {
  const ALL: MarketsData[] = [
    { state: 'ok', instruments: [{ symbol: 'BTCUSD', name: 'Bitcoin', digits: 2, icon: null }] },
    { state: 'ok', instruments: [] },
    { state: 'access-empty' },
    { state: 'access-unavailable', reason: 'not-configured' },
    { state: 'access-unavailable', reason: 'http-error' },
    { state: 'access-unavailable', reason: 'network' },
    { state: 'access-unavailable', reason: 'malformed' },
    { state: 'catalog-unavailable', reason: 'not-configured' },
    { state: 'catalog-unavailable', reason: 'http-error' },
    { state: 'catalog-unavailable', reason: 'network' },
  ];

  it('РАСТЯЖКА: у каждого состояния либо таблица, либо объяснение — третьего нет', () => {
    for (const data of ALL) {
      const hasRows = data.state === 'ok' && data.instruments.length > 0;
      const notice = describeNotice(data, 2);
      // Ровно одно из двух (XOR). `null` без строк — это и есть исчезнувший
      // модуль; объяснение поверх таблицы — наоборот, лишний шум.
      expect({ state: data.state, exclusive: hasRows !== (notice !== null) }).toEqual({
        state: data.state,
        exclusive: true,
      });
    }
  });

  it('РАСТЯЖКА: выключенные вкладки тоже объясняются, а не прячут модуль', () => {
    const data: MarketsData = {
      state: 'ok',
      instruments: [{ symbol: 'BTCUSD', name: 'Bitcoin', digits: 2, icon: null }],
    };

    expect(describeNotice(data, 0)?.titleKey).toBe('marketsNoTabsTitle');
  });

  it('РАСТЯЖКА: закрытая граница объясняется раньше, чем конфигурация вкладок', () => {
    // Порядок вердиктов от сильного знания к слабому: если ничего не
    // разрешено, число вкладок к делу не относится
    expect(describeNotice({ state: 'access-empty' }, 0)?.titleKey).toBe('marketsClosedEmptyTitle');
  });
});
