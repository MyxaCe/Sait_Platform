import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchTenantConfig } from './config';
import { readConfigExpiry } from './expiry';

const ORIGIN = Date.parse('2026-10-19T12:00:00.000Z');
const BASE = { baseUrl: 'http://cms.test', slug: 'apex-ru' };

const CMS_SHAPED = '2026-10-19T12:30:00.000Z';

function stubFetch(body: unknown, init: ResponseInit = {}) {
  const mock = vi.fn(() => Promise.resolve(Response.json(body, init)));
  vi.stubGlobal('fetch', mock);
  return mock;
}

function v1(instrumentsExpiresAt: unknown, instruments: string[] = ['BTCUSD']) {
  const settings: Record<string, unknown> = { instruments, demoStartBalanceCents: 1_000_000 };
  if (instrumentsExpiresAt !== undefined) settings['instrumentsExpiresAt'] = instrumentsExpiresAt;
  return { instruments, demoStartBalanceCents: 1_000_000, settings };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('readConfigExpiry · что сказал источник в теле', () => {
  it('момент в форме CMS → named, и источник назван полем', () => {
    expect(readConfigExpiry({ instrumentsExpiresAt: CMS_SHAPED })).toEqual({
      state: 'named',
      expiresAt: Date.parse(CMS_SHAPED),
      source: 'config-field',
    });
  });

  it('момент берётся АБСОЛЮТНЫМ и ни к чему не привязывается', () => {
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
    expect(readConfigExpiry(settings)).toEqual({ state: 'malformed' });
  });

  it.each([
    ['settings нет', undefined],
    ['settings null', null],
    ['settings массив', ['BTCUSD']],
    ['settings строка', 'нет'],
  ])('%s → unnamed: это не site-config.v1, срока здесь не обещали', (_label, settings) => {
    expect(readConfigExpiry(settings)).toEqual({ state: 'unnamed' });
  });
});

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
    stubFetch(v1(undefined));

    const config = await fetchTenantConfig({ ...BASE, now: () => ORIGIN });

    expect(config.access).toEqual({ state: 'unavailable', reason: 'expiry-malformed' });
    expect(config.access).not.toEqual({ state: 'unavailable', reason: 'expired' });
  });

  it('нечитаемый обязательный срок кричит в лог, а не закрывает молча', async () => {
    const onUnavailable = vi.fn();
    stubFetch(v1('завтра'));

    await fetchTenantConfig({ ...BASE, now: () => ORIGIN, onUnavailable });

    expect(onUnavailable).toHaveBeenCalledWith('expiry-malformed', expect.anything());
  });
});

describe('поле тела старше заголовков', () => {
  it('есть и поле, и max-age → побеждает поле', async () => {
    stubFetch(v1(CMS_SHAPED), {
      headers: { date: new Date(ORIGIN).toUTCString(), 'cache-control': 'max-age=60' },
    });

    const config = await fetchTenantConfig({ ...BASE, now: () => ORIGIN });

    expect(config.expiry).toEqual({
      state: 'named',
      expiresAt: Date.parse(CMS_SHAPED),
      source: 'config-field',
    });
    expect(config.access.state).toBe('allowed');
  });

  it('поле нечитаемо → заголовки его НЕ спасают', async () => {
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

describe('слаг не назван · в CMS не идём вовсе (PKG-05)', () => {
  it('slug: null → not-configured, и СЕТЬ НЕ ТРОНУТА', () => {
    const mock = vi.fn(() => Promise.resolve(Response.json({ instruments: ['BTCUSD'] })));
    vi.stubGlobal('fetch', mock);

    return fetchTenantConfig({ baseUrl: 'http://cms.test', slug: null }).then((config) => {
      expect(config.access).toEqual({ state: 'unavailable', reason: 'not-configured' });
      expect(mock).not.toHaveBeenCalled();
    });
  });

  it('ПАРНАЯ: со слагом в сеть идём и границу открываем', () => {
    const mock = vi.fn(() => Promise.resolve(Response.json({ instruments: ['BTCUSD'] })));
    vi.stubGlobal('fetch', mock);

    return fetchTenantConfig({ baseUrl: 'http://cms.test', slug: 'apex-ru' }).then((config) => {
      expect(config.access.state).toBe('allowed');
      expect(mock).toHaveBeenCalledTimes(1);
    });
  });
});

describe('РАСТЯЖКА · legacy-ответ не закрывается за отсутствие срока', () => {
  it('плоский ответ без settings и без заголовков → граница КАК ЕСТЬ', async () => {
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
