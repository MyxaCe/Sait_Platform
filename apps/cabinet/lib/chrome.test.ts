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

describe('как показывать бренд в шапке', () => {
  it('старая CMS без logoMode → null (прежнее поведение: логотип и название)', async () => {
    stubFetch(BRAND_V2);
    expect((await getChromeBrand('ru'))?.logoMode).toBeNull();
  });

  it('logo из CMS доезжает, незнакомое значение не ломает бренд', async () => {
    stubFetch({ ...BRAND_V2, logoMode: 'logo' });
    expect((await getChromeBrand('ru'))?.logoMode).toBe('logo');
    stubFetch({ ...BRAND_V2, logoMode: 'sideways' });
    const brand = await getChromeBrand('ru');
    expect(brand?.logoMode).toBeNull();
    expect(brand?.name).toBe('Apex Capital');
  });
});

describe('юрлицо и лицензии', () => {
  it('старая CMS без legalEntity → null, бренд цел', async () => {
    stubFetch(BRAND_V2);
    const brand = await getChromeBrand('ru');
    expect(brand?.legalEntity).toBeNull();
    expect(brand?.name).toBe('Apex Capital');
  });

  it('юрлицо доезжает; http-ссылка на реестр отбрасывается, лицензия остаётся', async () => {
    stubFetch({
      ...BRAND_V2,
      legalEntity: {
        name: 'Example Ltd',
        registrationNumber: null,
        address: null,
        licenses: [
          {
            number: 'LIC-0001',
            activity: null,
            regulator: 'Example Authority',
            regulatorCountry: null,
            verifyUrl: 'http://register.example.test/firms/LIC-0001',
            document: null,
          },
        ],
      },
    });
    const brand = await getChromeBrand('ru');
    expect(brand?.legalEntity?.name).toBe('Example Ltd');
    expect(brand?.legalEntity?.licenses[0]).toMatchObject({ number: 'LIC-0001', verifyUrl: null });
  });

  it('мусор вместо legalEntity → null, бренд цел', async () => {
    stubFetch({ ...BRAND_V2, legalEntity: 'Example Ltd' });
    const brand = await getChromeBrand('ru');
    expect(brand?.legalEntity).toBeNull();
    expect(brand?.socials).toHaveLength(1);
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
  const fromCms = { name: 'Из CMS', primaryColor: null, logo: null, logoMode: null, socials: [], legalEntity: null };

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
