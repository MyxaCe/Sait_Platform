import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getChromeBrand, resolveBrandName } from './chrome';

const BRAND_V2 = {
  name: 'Apex Capital',
  primaryColor: null,
  logo: { url: 'http://cms.test/logo.png', width: 10, height: 10, alt: 'Apex' },
  socials: [{ name: 'telegram', url: 'https://t.me/apex' }],
};

beforeEach(() => {
  vi.stubEnv('CMS_API_URL', 'http://cms.test');
  vi.stubEnv('SITE_SLUG', 'apex-ru');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubFetch(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json(body))));
}

describe('цвет не задан', () => {
  it('РАСТЯЖКА: бренд остаётся — имя, логотип и соцсети на месте', () => {
    stubFetch(BRAND_V2);

    return getChromeBrand('ru').then((brand) => {
      expect(brand?.name).toBe('Apex Capital');
      expect(brand?.logo?.url).toBe('http://cms.test/logo.png');
      expect(brand?.socials).toHaveLength(1);
      expect(brand?.primaryColor).toBeNull();
    });
  });

  it('строковый цвет по-прежнему доезжает', async () => {
    stubFetch({ ...BRAND_V2, primaryColor: '#0b5fff' });

    expect((await getChromeBrand('ru'))?.primaryColor).toBe('#0b5fff');
  });
});

describe('бренда нет', () => {
  it('ответ без имени → null: показывать нечего, статический фолбэк', async () => {
    stubFetch({ primaryColor: '#0b5fff' });

    expect(await getChromeBrand('ru')).toBeNull();
  });
});

describe('resolveBrandName', () => {
  afterEach(() => vi.unstubAllEnvs());
  const fromCms = { name: 'Из CMS', primaryColor: null, logo: null, socials: [] };

  it('CMS ответила → имя из CMS, даже если окружение задано', () => {
    vi.stubEnv('SITE_BRAND_NAME', 'Из окружения');
    expect(resolveBrandName(fromCms, 'Личный кабинет')).toBe('Из CMS');
  });

  it('CMS нет → окружение ячейки', () => {
    vi.stubEnv('SITE_BRAND_NAME', 'Из окружения');
    expect(resolveBrandName(null, 'Личный кабинет')).toBe('Из окружения');
  });

  it('нет ни CMS, ни окружения → нейтральная метка, а не выдуманное имя', () => {
    vi.stubEnv('SITE_BRAND_NAME', '');
    expect(resolveBrandName(null, 'Личный кабинет')).toBe('Личный кабинет');
  });
});
