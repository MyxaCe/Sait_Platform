import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTenantConfig } from './config';
import { readConfigExpiry } from './expiry';

/**
 * WEB-06 / Р-042: срок годности списка читается из ПОЛЯ ТЕЛА
 * `settings.instrumentsExpiresAt`, а не только из заголовков ответа.
 *
 * **Что именно здесь проверяется и чего эти тесты НЕ доказывают.**
 * Доказывается, что мы читаем поле так, как его описывает схема
 * `site-config.v1` в репозитории CMS. Не доказывается, что поле до нас
 * доезжает: витрина и кабинет сегодня читают legacy
 * `GET /v1/cms/sites/{slug}` (`cms-legacy`, плоские `instruments`), где
 * объекта `settings` нет вовсе и срока никто не обещал. Пока потребители
 * не переедут на `GET /v1/sites/{slug}/config`, ветка `config-field`
 * **не исполняется на контуре ни разу**.
 *
 * Это названо вслух и здесь, и в коде, и в отчёте штабу намеренно: класс
 * «написано и не вызывается» мы ловили уже четырежды, и каждый раз он
 * жил рядом с зелёными тестами — функция-то исправна.
 *
 * **Самый важный тест файла — не про поле, а про его отсутствие:**
 * legacy-ответ обязан НЕ закрывать границу. Правило «нет срока — значит
 * истёк» принадлежит контракту `site-config.v1`; применить его к ответу,
 * который этот контракт не подписывал, значило бы погасить витрину
 * целиком в день выкатки.
 */

const ORIGIN = Date.parse('2026-10-19T12:00:00.000Z');
const BASE = { baseUrl: 'http://cms.test', slug: 'apex-ru' };

/**
 * Момент в том виде, в каком его отдаёт CMS: ISO-8601 с миллисекундами и
 * `Z`, квантованный по сетке в одно время жизни (900 с). Форма снята с
 * `cms/src/modules/delivery/api/instruments-expiry.ts`, а не придумана.
 */
const CMS_SHAPED = '2026-10-19T12:30:00.000Z';

function stubFetch(body: unknown, init: ResponseInit = {}) {
  const mock = vi.fn(() => Promise.resolve(Response.json(body, init)));
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** Ответ `site-config.v1`: разрешения и срок лежат под `settings`. */
function v1(instrumentsExpiresAt: unknown, instruments: string[] = ['BTCUSD']) {
  const settings: Record<string, unknown> = { instruments, demoStartBalanceCents: 1_000_000 };
  if (instrumentsExpiresAt !== undefined) settings['instrumentsExpiresAt'] = instrumentsExpiresAt;
  // `instruments` дублируется наверх: сегодняшний разбор границы читает
  // плоское поле, и подменять им предмет проверки нельзя — проверяется
  // СРОК, а не переезд на новую форму ответа.
  return { instruments, demoStartBalanceCents: 1_000_000, settings };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* 1. Разбор поля                                                       */
/* ------------------------------------------------------------------ */

describe('readConfigExpiry · что сказал источник в теле', () => {
  it('момент в форме CMS → named, и источник назван полем', () => {
    expect(readConfigExpiry({ instrumentsExpiresAt: CMS_SHAPED })).toEqual({
      state: 'named',
      expiresAt: Date.parse(CMS_SHAPED),
      source: 'config-field',
    });
  });

  it('момент берётся АБСОЛЮТНЫМ и ни к чему не привязывается', () => {
    // Главный выбор Р-042: срок отсчитан от выдачи ответа, а не от
    // `builtAt`. Пересчёт от «сейчас» обнулял бы окно при каждом чтении
    // из кеша данных Next, и список не истекал бы никогда; привязка к
    // времени сборки закрывала бы давно не публиковавшийся сайт при
    // исправных разрешениях.
    const parsed = readConfigExpiry({ instrumentsExpiresAt: '2001-01-01T00:00:00.000Z' });

    expect(parsed).toEqual({
      state: 'named',
      expiresAt: Date.parse('2001-01-01T00:00:00.000Z'),
      source: 'config-field',
    });
  });

  it.each([
    ['поля нет вовсе', {}],
    ['поле null', { instrumentsExpiresAt: null }],
    ['поле число', { instrumentsExpiresAt: 1_760_000_000_000 }],
    ['строка не момент', { instrumentsExpiresAt: 'завтра' }],
    ['строка "NaN"', { instrumentsExpiresAt: 'NaN' }],
    ['только год', { instrumentsExpiresAt: '2026' }],
    ['дата без времени', { instrumentsExpiresAt: '2026-10-19' }],
    ['время без зоны', { instrumentsExpiresAt: '2026-10-19T12:30:00' }],
    ['форма верна, даты не существует', { instrumentsExpiresAt: '2026-02-30T00:00:00.000Z' }],
  ])('%s → malformed, то есть ЗАКРЫТО, а не «молчание»', (_label, settings) => {
    // Поле обязательное у схемы. «Источник обязался назвать срок и не
    // назвал» — это не то же, что «источник о сроке не говорил»: первое
    // закрывает границу, второе оставляет её как есть.
    expect(readConfigExpiry(settings)).toEqual({ state: 'malformed' });
  });

  it.each([
    ['settings нет', undefined],
    ['settings null', null],
    ['settings массив', ['BTCUSD']],
    ['settings строка', 'нет'],
  ])('%s → unnamed: это не site-config.v1, срока здесь не обещали', (_label, settings) => {
    // Граница между «контракт нарушен» и «контракта не было». Стереть её
    // значит закрыть витрину за несоблюдение договора, который с этим
    // источником не заключали.
    expect(readConfigExpiry(settings)).toEqual({ state: 'unnamed' });
  });
});

/* ------------------------------------------------------------------ */
/* 2. Связка: ответ источника → решение границы                         */
/* ------------------------------------------------------------------ */

describe('связка · срок из тела доходит до границы', () => {
  it('срок в будущем → граница открыта', async () => {
    stubFetch(v1(CMS_SHAPED));

    const config = await fetchTenantConfig({ ...BASE, now: () => ORIGIN });

    expect(config.expiry).toEqual({
      state: 'named',
      expiresAt: Date.parse(CMS_SHAPED),
      source: 'config-field',
    });
    expect(config.access.state).toBe('allowed');
  });

  it('срок в прошлом → граница закрыта с причиной expired', async () => {
    stubFetch(v1('2026-10-19T11:00:00.000Z'));

    const config = await fetchTenantConfig({ ...BASE, now: () => ORIGIN });

    expect(config.access).toEqual({ state: 'unavailable', reason: 'expired' });
  });

  it('обязательного поля нет → expiry-malformed, и это НЕ expired', async () => {
    // Две разные неполадки: «список состарился» и «источник не сказал,
    // когда он состарится». Слить их значило бы отправить дежурного
    // ждать обновления вместо того, чтобы чинить выдачу.
    stubFetch(v1(undefined));

    const config = await fetchTenantConfig({ ...BASE, now: () => ORIGIN });

    expect(config.access).toEqual({ state: 'unavailable', reason: 'expiry-malformed' });
    expect(config.access).not.toEqual({ state: 'unavailable', reason: 'expired' });
  });

  it('нечитаемый обязательный срок кричит в лог, а не закрывает молча', async () => {
    // Молча закрытая граница — скрытая авария (R-15). Отказ без
    // наблюдаемого следа непроверяем, а не просто неудобен.
    const onUnavailable = vi.fn();
    stubFetch(v1('завтра'));

    await fetchTenantConfig({ ...BASE, now: () => ORIGIN, onUnavailable });

    expect(onUnavailable).toHaveBeenCalledWith('expiry-malformed', expect.anything());
  });
});

/* ------------------------------------------------------------------ */
/* 3. Старшинство источников срока                                      */
/* ------------------------------------------------------------------ */

describe('поле тела старше заголовков', () => {
  it('есть и поле, и max-age → побеждает поле', async () => {
    // `Cache-Control` говорит о переиспользовании ОТВЕТА посредником,
    // поле — о действительности РАЗРЕШЕНИЙ. Разные величины; закрывать
    // границу по второй, когда есть первая, значит мерить соседнее.
    stubFetch(v1(CMS_SHAPED), {
      headers: { date: new Date(ORIGIN).toUTCString(), 'cache-control': 'max-age=60' },
    });

    const config = await fetchTenantConfig({ ...BASE, now: () => ORIGIN });

    expect(config.expiry).toEqual({
      state: 'named',
      expiresAt: Date.parse(CMS_SHAPED),
      source: 'config-field',
    });
    // Срок из заголовка истёк бы через 60 с; поле говорит про 30 минут.
    expect(config.access.state).toBe('allowed');
  });

  it('поле нечитаемо → заголовки его НЕ спасают', async () => {
    // Иначе получился бы способ не закрыть границу, которую контракт
    // велел закрыть: достаточно отдать щедрый max-age.
    stubFetch(v1('мусор'), {
      headers: { date: new Date(ORIGIN).toUTCString(), 'cache-control': 'max-age=3600' },
    });

    const config = await fetchTenantConfig({ ...BASE, now: () => ORIGIN });

    expect(config.access).toEqual({ state: 'unavailable', reason: 'expiry-malformed' });
  });

  it('поля нет, потому что ответ legacy → работают заголовки', async () => {
    stubFetch(
      { instruments: ['BTCUSD'], demoStartBalanceCents: 1_000_000 },
      { headers: { date: new Date(ORIGIN).toUTCString(), 'cache-control': 'max-age=60' } },
    );

    const config = await fetchTenantConfig({ ...BASE, now: () => ORIGIN });

    expect(config.expiry).toEqual({
      state: 'named',
      expiresAt: ORIGIN + 60_000,
      source: 'response-headers',
    });
  });
});

/* ------------------------------------------------------------------ */
/* 4. Растяжка: сегодняшний контур не должен погаснуть                  */
/* ------------------------------------------------------------------ */

describe('РАСТЯЖКА · legacy-ответ не закрывается за отсутствие срока', () => {
  it('плоский ответ без settings и без заголовков → граница КАК ЕСТЬ', async () => {
    // Ровно то, что отдаёт `cms-legacy` сегодня: `Cache-Control: no-store`
    // (для нас — молчание о сроке) и никакого `settings`. Если правило
    // «нет срока — значит истёк» применить и к нему, витрина погаснет
    // целиком в день выкатки этой правки.
    //
    // Тот, кто захочет «дозакрыть» Р-030, ужесточив это место, увидит
    // здесь причину, по которой ужесточать нельзя без переезда
    // потребителей на `GET /v1/sites/{slug}/config`.
    stubFetch(
      { instruments: ['BTCUSD'], demoStartBalanceCents: 1_000_000 },
      { headers: { 'cache-control': 'no-store' } },
    );

    const config = await fetchTenantConfig({ ...BASE, now: () => ORIGIN });

    expect(config.expiry).toEqual({ state: 'unnamed' });
    expect(config.access.state).toBe('allowed');
  });

  it('пустой allow-list legacy остаётся empty, а не превращается в отказ срока', async () => {
    stubFetch({ instruments: [], demoStartBalanceCents: 1_000_000 });

    const config = await fetchTenantConfig({ ...BASE, now: () => ORIGIN });

    expect(config.access).toEqual({ state: 'empty' });
  });
});
