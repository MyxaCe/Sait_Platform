import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Тесты getCms — точки, где сайт решает, откуда взять контент (WEB-01).
 *
 * Два РАЗНЫХ пути, которые легко спутать:
 *   1. «CMS не настроена» — CMS_API_URL пуст. Сайт ЗНАЕТ, что боевых данных
 *      не будет, и строит их сам. Сетевого вызова нет вообще.
 *   2. «CMS отвалилась в рантайме» — CMS_API_URL задан, сайт идёт за данными
 *      и УЗНАЁТ о недоступности по факту: отказ соединения, 5xx, таймаут,
 *      мусор вместо JSON. Здесь работает страховка cmsFetch.
 *
 * lib/cms-mock.test.ts не покрывает ни один из них: он проверяет, что
 * билдеры фикстур соответствуют Zod-контракту, и getCms не вызывает.
 *
 * unstable_cache подменён: вне request-контекста Next бросает
 * «Invariant: incrementalCache missing». Кеш здесь не предмет проверки.
 */

vi.mock('next/headers', () => ({ draftMode: () => ({ isEnabled: false }) }));
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}));

const FIXTURE_ERROR = 'фикстура разъехалась с контрактом';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock('./cms-mock');
});

function stubFetch(impl: () => Promise<Response>) {
  const mock = vi.fn(impl);
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('getCms · CMS не настроена (CMS_API_URL пуст)', () => {
  it('отдаёт фикстуры, НЕ ходит в сеть и НЕ считает это аварией', async () => {
    vi.stubEnv('CMS_API_URL', '');
    const fetchMock = stubFetch(() => Promise.reject(new Error('сети быть не должно')));

    const { getCms } = await import('./cms');
    const faq = await getCms('faq', { locale: 'ru' });

    expect(faq.sections.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
    // Отличает «не настроена» от «отвалилась»: во втором случае cmsFetch
    // обязан прокричать в лог (R-15). Ненастроенная CMS — конфигурация
    // контура, а не инцидент, и в логе ошибок ей делать нечего.
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe('getCms · CMS отвалилась в рантайме (CMS_API_URL задан)', () => {
  beforeEach(() => {
    vi.stubEnv('CMS_API_URL', 'http://cms.test');
  });

  it('соединение отклонено → фикстуры, страница живёт', async () => {
    const fetchMock = stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));

    const { getCms } = await import('./cms');
    const faq = await getCms('faq', { locale: 'ru' });

    expect(fetchMock).toHaveBeenCalled(); // сходили и узнали по факту
    expect(faq.sections.length).toBeGreaterThan(0);
    expect(console.error).toHaveBeenCalled(); // фолбэк без алерта — скрытая авария (R-15)
  });

  it('CMS отвечает 503 → фикстуры', async () => {
    stubFetch(() => Promise.resolve(new Response('unavailable', { status: 503 })));

    const { getCms } = await import('./cms');
    expect((await getCms('faq', { locale: 'en' })).sections.length).toBeGreaterThan(0);
  });

  it('таймаут CMS → фикстуры (сайт не ждёт соседа дольше своего бюджета)', async () => {
    stubFetch(
      () =>
        new Promise((_, reject) =>
          setTimeout(() => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), 5),
        ),
    );

    const { getCms } = await import('./cms');
    expect((await getCms('faq', { locale: 'ru' })).sections.length).toBeGreaterThan(0);
  });

  it('CMS отвечает мусором мимо схемы → фикстуры (мусор не доходит до страниц)', async () => {
    stubFetch(() => Promise.resolve(Response.json({ sections: 'не массив' })));

    const { getCms } = await import('./cms');
    const faq = await getCms('faq', { locale: 'ru' });

    expect(Array.isArray(faq.sections)).toBe(true);
    expect(faq.sections.length).toBeGreaterThan(0);
  });

  it('CMS жива → боевые данные, фикстуры не подмешиваются', async () => {
    const live = { sections: [{ title: 'Из CMS', items: [{ question: 'q', answer: 'a' }] }] };
    stubFetch(() => Promise.resolve(Response.json(live)));

    const { getCms } = await import('./cms');
    expect((await getCms('faq', { locale: 'ru' })).sections[0]!.title).toBe('Из CMS');
  });
});

/**
 * Отдельный класс: ломается не CMS, а сама страховка. Фикстура строится
 * синхронно ДО ухода в сеть, поэтому её исключение летит мимо try/catch
 * внутри cmsFetch — и роняет страницу, к которой боевая CMS отношения
 * не имеет (баг B-017).
 */
describe('getCms · сломана сама фикстура', () => {
  beforeEach(() => {
    vi.stubEnv('CMS_API_URL', 'http://cms.test');
    vi.doMock('./cms-mock', () => ({
      CMS_MOCK: {
        faq: () => {
          throw new Error(FIXTURE_ERROR);
        },
      },
      buildArticleDetail: () => null,
    }));
  });

  it('живая CMS + сломанная фикстура → боевые данные, а не 500', async () => {
    const live = { sections: [{ title: 'Из CMS', items: [{ question: 'q', answer: 'a' }] }] };
    const fetchMock = stubFetch(() => Promise.resolve(Response.json(live)));

    const { getCms } = await import('./cms');
    const faq = await getCms('faq', { locale: 'ru' });

    expect(fetchMock).toHaveBeenCalled();
    expect(faq.sections[0]!.title).toBe('Из CMS');
    expect(console.error).toHaveBeenCalled(); // поломку страховки видно
  });

  it('лежащая CMS + сломанная фикстура → ошибка наружу, а не тихая подмена', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));

    const { getCms } = await import('./cms');
    await expect(getCms('faq', { locale: 'ru' })).rejects.toThrow();
  });
});
