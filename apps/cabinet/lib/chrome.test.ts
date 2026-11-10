import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getChromeBrand, resolveBrandName } from './chrome';

/**
 * Хром кабинета при переезде на CMS v2 (Р-040).
 *
 * Проверяется одно утверждение, и оно про соседние поля: отсутствие
 * необязательного `primaryColor` не доказывает отсутствия бренда.
 * Прежнее условие требовало строки, и после переезда кабинет потерял бы
 * заодно имя, логотип и соцсети — из-за пустого цвета.
 */

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
      // Мутация «вернуть `typeof data.primaryColor === 'string'` в
      // условие» красит этот тест: бренд целиком становится `null`.
      expect(brand?.name).toBe('Apex Capital');
      expect(brand?.logo?.url).toBe('http://cms.test/logo.png');
      expect(brand?.socials).toHaveLength(1);
      // Цвет при этом честно отсутствует, а не подменён пустой строкой:
      // акцент тогда не инжектируется и действует палитра токенов.
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

/**
 * Имя бренда без строки бренда в коде (10.11): CMS → окружение ячейки
 * `SITE_BRAND_NAME` (мост) → нейтральная метка интерфейса.
 */
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
