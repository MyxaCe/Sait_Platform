import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cabinetRegisterHref } from './cabinet-links';
import { resetSiteLanguagesCache, siteLanguagesForMiddleware } from './site-languages-edge';
import { fetchSiteLanguages } from './site-languages-source';

const json = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('языки сайта из карточки CMS', () => {
  beforeEach(() => {
    vi.stubEnv('CMS_API_URL', 'http://cms.test/v1');
    vi.stubEnv('SITE_SLUG', 'demo');
    resetSiteLanguagesCache();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('ходит в /cms/sites/{slug} и читает languages/defaultLanguage', async () => {
    const fetchImpl = json({ languages: ['de', 'en'], defaultLanguage: 'de' });
    const result = await fetchSiteLanguages({ baseUrl: 'http://cms.test/v1/', slug: 'demo', fetchImpl });
    expect(result).toEqual({ state: 'ok', value: { languages: ['de', 'en'], defaultLanguage: 'de' } });
    expect((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0]).toBe('http://cms.test/v1/cms/sites/demo');
  });

  it('старая CMS без полей — ru/en, ru: адреса не меняются', async () => {
    expect(await siteLanguagesForMiddleware(json({ instruments: [] }), 0)).toEqual({
      languages: ['ru', 'en'],
      defaultLanguage: 'ru',
    });
  });

  it('CMS недоступна — последний удачный ответ, а без него — совместимое умолчание', async () => {
    expect(await siteLanguagesForMiddleware(json({}, 503), 0)).toEqual({ languages: ['ru', 'en'], defaultLanguage: 'ru' });
    await siteLanguagesForMiddleware(json({ languages: ['ru', 'de'], defaultLanguage: 'ru' }), 100_000);
    expect(await siteLanguagesForMiddleware(json({}, 503), 200_000)).toEqual({
      languages: ['ru', 'de'],
      defaultLanguage: 'ru',
    });
  });

  it('ответ кешируется, CMS не спрашивается на каждый запрос', async () => {
    const fetchImpl = json({ languages: ['ru', 'fr'] });
    await siteLanguagesForMiddleware(fetchImpl, 0);
    await siteLanguagesForMiddleware(fetchImpl, 1_000);
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });

  it('без слага в CMS не ходим', async () => {
    vi.stubEnv('SITE_SLUG', '');
    const fetchImpl = json({ languages: ['de'] });
    expect((await siteLanguagesForMiddleware(fetchImpl, 0)).defaultLanguage).toBe('ru');
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });
});

describe('ссылки в кабинет следуют языку сайта по умолчанию', () => {
  it('язык по умолчанию — без префикса, остальные — с префиксом', () => {
    expect(cabinetRegisterHref('/register?promo=x', 'ru')).toMatch(/[^/]\/register\?promo=x$/);
    expect(cabinetRegisterHref('/register', 'de')).toMatch(/\/de\/register$/);
    expect(cabinetRegisterHref('/register', 'de', 'de')).not.toMatch(/\/de\//);
    expect(cabinetRegisterHref('/register', 'ru', 'de')).toMatch(/\/ru\/register$/);
  });
});
