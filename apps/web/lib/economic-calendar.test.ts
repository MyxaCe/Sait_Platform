import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CALENDAR_FRESH_MS,
  CALENDAR_STALE_MS,
  loadCalendar,
  maskCalendarUrl,
  parseCalendarEvent,
  parseCalendarResponse,
  parseWeekOffset,
  resetCalendarCache,
  utcWeek,
} from './economic-calendar';

const BASE = 'https://calendar.example.test/secret-key-abc123';
const env = { CALENDAR_API_URL: BASE };
const query = { from: '2026-11-16', to: '2026-11-22', lang: 'de' };

const good = {
  id: 'us-cpi-2026-11-18',
  datetime: '2026-11-18T13:30:00Z',
  country: 'US',
  currency: 'USD',
  title: 'Consumer Price Index (YoY)',
  importance: 3,
  previous: '3.1%',
  forecast: '3.0%',
  actual: null,
  revisedPrevious: null,
  updatedAt: '2026-11-17T08:00:00Z',
};

const body = (events: unknown[], extra: Record<string, unknown> = {}) => ({
  events,
  lang: 'en',
  source: 'ForexFactory (faireconomy.media)',
  complete: true,
  ...extra,
});

function respond(status: number, payload?: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(payload === undefined ? 'nope' : JSON.stringify(payload), { status }),
  ) as unknown as typeof fetch;
}

let errors: ReturnType<typeof vi.spyOn>;
let warns: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetCalendarCache();
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  warns = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

function logged(): string {
  return [...errors.mock.calls, ...warns.mock.calls].flat().map(String).join('\n');
}

describe('разбор ответа модуля календаря', () => {
  it('валидное событие проходит, actual null остаётся null', () => {
    expect(parseCalendarEvent(good)).toEqual({
      id: good.id,
      datetime: '2026-11-18T13:30:00.000Z',
      currency: 'USD',
      title: good.title,
      importance: 3,
      previous: '3.1%',
      forecast: '3.0%',
      actual: null,
      allDay: false,
    });
  });

  it.each([
    ['без id', { ...good, id: undefined }],
    ['кривая дата', { ...good, datetime: 'вчера' }],
    ['важность 4', { ...good, importance: 4 }],
    ['важность строкой', { ...good, importance: '3' }],
    ['пустое название', { ...good, title: ' ' }],
    ['число вместо строки', { ...good, previous: 3.1 }],
    ['без валюты', { ...good, currency: '' }],
    ['allDay не булево', { ...good, allDay: 'yes' }],
    ['не объект', 'событие'],
  ])('битое поле (%s) — событие отброшено', (_name, raw) => {
    expect(parseCalendarEvent(raw)).toBeNull();
  });

  it('битые события отбрасываются, остальные остаются и сортируются', () => {
    const later = { ...good, id: 'b', datetime: '2026-11-19T10:00:00Z' };
    const parsed = parseCalendarResponse(body([later, { ...good, importance: 7 }, good]));
    expect(parsed?.dropped).toBe(1);
    expect(parsed?.data.events.map((e) => e.id)).toEqual([good.id, 'b']);
    expect(parsed?.data.source).toBe('ForexFactory (faireconomy.media)');
    expect(parsed?.data.lang).toBe('en');
  });

  it('пустая строка значения — нет значения, а не ноль', () => {
    expect(parseCalendarEvent({ ...good, forecast: '' })?.forecast).toBeNull();
  });

  it('allDay сохраняется', () => {
    expect(parseCalendarEvent({ ...good, allDay: true })?.allDay).toBe(true);
  });

  it('complete:false сохраняется, отсутствие поля не выдаётся за неполноту', () => {
    expect(parseCalendarResponse(body([], { complete: false }))?.data.complete).toBe(false);
    expect(parseCalendarResponse({ events: [], lang: 'en', source: 'x' })?.data.complete).toBe(true);
  });

  it('тело без массива events — не по контракту', () => {
    expect(parseCalendarResponse({ events: 'none' })).toBeNull();
    expect(parseCalendarResponse(null)).toBeNull();
  });
});

describe('неделя по UTC', () => {
  it('понедельник–воскресенье, считая от среды', () => {
    expect(utcWeek(new Date('2026-11-19T12:00:00Z'))).toEqual({ from: '2026-11-16', to: '2026-11-22' });
  });

  it('воскресенье поздно вечером по UTC — ещё та же неделя', () => {
    expect(utcWeek(new Date('2026-11-22T23:59:59Z'))).toEqual({ from: '2026-11-16', to: '2026-11-22' });
  });

  it('сдвиг на неделю вперёд и назад через границу месяца', () => {
    expect(utcWeek(new Date('2026-11-19T12:00:00Z'), 2)).toEqual({ from: '2026-11-30', to: '2026-12-06' });
    expect(utcWeek(new Date('2026-11-19T12:00:00Z'), -1)).toEqual({ from: '2026-11-09', to: '2026-11-15' });
  });

  it('параметр недели: только целое в разрешённых пределах', () => {
    expect(parseWeekOffset('1')).toBe(1);
    expect(parseWeekOffset('-2')).toBe(-2);
    expect(parseWeekOffset('99')).toBe(0);
    expect(parseWeekOffset('1.5')).toBe(0);
    expect(parseWeekOffset(undefined)).toBe(0);
    expect(parseWeekOffset(['-1', '3'])).toBe(-1);
  });
});

describe('загрузка календаря', () => {
  it('переменная не задана — «нет источника», в сеть не ходим', async () => {
    const fetchImpl = respond(200, body([good]));
    expect(await loadCalendar(query, { env: {}, fetchImpl })).toEqual({ state: 'not-configured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('запрос по контракту: путь, период, язык страницы', async () => {
    const fetchImpl = respond(200, body([good]));
    const result = await loadCalendar(query, { env: { CALENDAR_API_URL: `${BASE}/` }, fetchImpl });
    expect(result.state).toBe('ok');
    const url = new URL(String(vi.mocked(fetchImpl).mock.calls[0]![0]));
    expect(url.pathname).toBe('/secret-key-abc123/calendar/v1/events');
    expect(Object.fromEntries(url.searchParams)).toEqual({ from: '2026-11-16', to: '2026-11-22', lang: 'de' });
  });

  it('язык ответа не подменяется', async () => {
    const result = await loadCalendar(query, { env, fetchImpl: respond(200, body([good])) });
    expect(result.state === 'ok' && result.data.lang).toBe('en');
    expect(result.state === 'ok' && result.data.events[0]!.title).toBe(good.title);
  });

  it('пустой период — пустой список, а не ошибка', async () => {
    const result = await loadCalendar(query, {
      env,
      fetchImpl: respond(200, body([], { complete: false })),
    });
    expect(result).toMatchObject({ state: 'ok', stale: false, data: { events: [], complete: false } });
  });

  it.each([
    ['503', () => respond(503, { error: 'no data yet' }), 'http-error'],
    ['400', () => respond(400, { error: 'bad params' }), 'http-error'],
    ['не JSON', () => respond(200), 'malformed'],
    ['не по контракту', () => respond(200, { items: [] }), 'malformed'],
    [
      'сеть',
      () =>
        vi.fn(async () => {
          throw new TypeError('fetch failed');
        }) as unknown as typeof fetch,
      'network',
    ],
  ])('%s без запаса — «временно недоступно»', async (_name, make, reason) => {
    expect(await loadCalendar(query, { env, fetchImpl: make() })).toEqual({ state: 'unavailable', reason });
  });

  it('60 с отвечаем из кэша, не дёргая модуль', async () => {
    let now = 1_000_000;
    const fetchImpl = respond(200, body([good]));
    await loadCalendar(query, { env, fetchImpl, now: () => now });
    now += CALENDAR_FRESH_MS - 1;
    const again = await loadCalendar(query, { env, fetchImpl, now: () => now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(again).toMatchObject({ state: 'ok', stale: false });
    now += 2;
    await loadCalendar(query, { env, fetchImpl, now: () => now });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('кэш раздельный по языку и периоду', async () => {
    const fetchImpl = respond(200, body([good]));
    await loadCalendar(query, { env, fetchImpl });
    await loadCalendar({ ...query, lang: 'ru' }, { env, fetchImpl });
    await loadCalendar({ ...query, from: '2026-11-23', to: '2026-11-29' }, { env, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('ошибка модуля — последний удачный ответ не старше 6 часов, с пометкой', async () => {
    let now = 1_000_000;
    await loadCalendar(query, { env, fetchImpl: respond(200, body([good])), now: () => now });
    now += CALENDAR_STALE_MS;
    const result = await loadCalendar(query, { env, fetchImpl: respond(503), now: () => now });
    expect(result).toMatchObject({ state: 'ok', stale: true, fetchedAt: 1_000_000 });
    expect(result.state === 'ok' && result.data.events).toHaveLength(1);
  });

  it('запас старше 6 часов не показываем', async () => {
    let now = 1_000_000;
    await loadCalendar(query, { env, fetchImpl: respond(200, body([good])), now: () => now });
    now += CALENDAR_STALE_MS + 1;
    expect(await loadCalendar(query, { env, fetchImpl: respond(503), now: () => now })).toEqual({
      state: 'unavailable',
      reason: 'http-error',
    });
  });
});

describe('адрес модуля в логах замаскирован', () => {
  it('маска: хост и «/…»', () => {
    expect(maskCalendarUrl(BASE)).toBe('https://calendar.example.test/…');
    expect(maskCalendarUrl('не адрес')).not.toContain('адрес/');
  });

  it('ни ошибка, ни предупреждение о битых событиях не печатают ключ', async () => {
    await loadCalendar(query, { env, fetchImpl: respond(200, body([good, { ...good, id: 1 }])) });
    resetCalendarCache();
    await loadCalendar(query, { env, fetchImpl: respond(503) });
    resetCalendarCache();
    await loadCalendar(query, {
      env,
      fetchImpl: vi.fn(async () => {
        throw new TypeError(`fetch failed ${BASE}`);
      }) as unknown as typeof fetch,
    });
    const text = logged();
    expect(errors).toHaveBeenCalledTimes(2);
    expect(warns).toHaveBeenCalledTimes(1);
    expect(text).toContain('https://calendar.example.test/…');
    expect(text).not.toContain('secret-key-abc123');
  });
});
