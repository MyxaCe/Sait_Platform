import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * getCms — точка, где витрина решает, что показать (решение владельца 10.11).
 *
 * Контента в коде нет даже как запасного: прежде при любой ошибке CMS и на
 * сборке без CMS подставлялись фикстуры из `lib/cms-mock.ts`, и стенд час
 * после каждого деплоя показывал код вместо CMS. Теперь:
 *   CMS ответила            → данные, и они сохраняются как «последние»;
 *   CMS не ответила          → последняя сохранённая версия ответа CMS;
 *   сохранённой нет          → CmsUnavailableError (страница → 503),
 *                              а НЕ «пустые данные»: пустой ответ ISR
 *                              закешировал бы поверх настоящей версии.
 *
 * Каталог последней версии — временный на каждый тест.
 */

vi.mock('next/headers', () => ({ draftMode: () => ({ isEnabled: false }) }));

const FAQ_LIVE = { sections: [{ title: 'Из CMS', items: [{ question: 'q', answer: 'a' }] }] };

let dir: string;

// Прогрев графа модулей (WEB-33): первый импорт платит за трансформацию.
beforeAll(async () => {
  await import('./cms');
});

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'cms-last-good-'));
  vi.stubEnv('CMS_LAST_GOOD_DIR', dir);
  vi.stubEnv('CMS_API_URL', 'http://cms.test');
  vi.stubEnv('SITE_SLUG', 'apex-ru');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  rmSync(dir, { recursive: true, force: true });
});

function stubFetch(impl: () => Promise<Response>) {
  const mock = vi.fn(impl);
  vi.stubGlobal('fetch', mock);
  return mock;
}

const errorLines = () =>
  (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));

describe('CMS жива', () => {
  it('отдаёт ответ CMS и сохраняет его как последнюю версию', async () => {
    stubFetch(() => Promise.resolve(Response.json(FAQ_LIVE)));
    const { getCms } = await import('./cms');

    expect((await getCms('faq', { locale: 'ru' })).sections[0]!.title).toBe('Из CMS');
    expect(readdirSync(dir).some((f) => f.startsWith('faq.apex-ru.ru.'))).toBe(true);
  });

  it('теги: и общий cms:<ресурс>, и cms:<ресурс>:<слаг> (вебхук не-дефолтного сайта)', async () => {
    vi.stubEnv('SITE_SLUG', 'apex-uk');
    const mock = stubFetch(() => Promise.resolve(Response.json(FAQ_LIVE)));
    const { getCms } = await import('./cms');
    await getCms('faq', { locale: 'ru' });

    const init = (mock.mock.calls[0] as unknown as [string, { next: { tags: string[] } }])[1];
    expect(init.next.tags).toEqual(['cms:faq', 'cms:faq:apex-uk']);
  });

  it('пустой ответ CMS — это данные, а не ошибка', async () => {
    stubFetch(() => Promise.resolve(Response.json({ sections: [] })));
    const { getCms } = await import('./cms');
    expect((await getCms('faq', { locale: 'ru' })).sections).toEqual([]);
  });
});

describe('CMS упала, последняя версия есть', () => {
  it.each([
    ['соединение отклонено', () => Promise.reject(new Error('ECONNREFUSED'))],
    ['503', () => Promise.resolve(new Response('down', { status: 503 }))],
    ['мусор мимо схемы', () => Promise.resolve(Response.json({ sections: 'не массив' }))],
  ])('%s → последний ответ CMS + лог уровня error', async (_name, failing) => {
    stubFetch(() => Promise.resolve(Response.json(FAQ_LIVE)));
    let { getCms } = await import('./cms');
    await getCms('faq', { locale: 'ru' });

    vi.resetModules(); // новый процесс: память о записанном сброшена, диск — нет
    stubFetch(failing as () => Promise<Response>);
    ({ getCms } = await import('./cms'));

    expect((await getCms('faq', { locale: 'ru' })).sections[0]!.title).toBe('Из CMS');
    expect(errorLines().some((l) => l.includes('последней версии'))).toBe(true);
  });

  it('версия хранится по сайту и локали: чужая не подставляется', async () => {
    stubFetch(() => Promise.resolve(Response.json(FAQ_LIVE)));
    const { getCms } = await import('./cms');
    await getCms('faq', { locale: 'ru' });

    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    await expect(getCms('faq', { locale: 'en' })).rejects.toThrow(/сохранённой версии нет/);
    vi.stubEnv('SITE_SLUG', 'apex-uk');
    await expect(getCms('faq', { locale: 'ru' })).rejects.toThrow(/сохранённой версии нет/);
  });
});

describe('CMS упала, сохранённой версии нет', () => {
  it('бросает CmsUnavailableError, а не возвращает пустые данные; ALERT в логе', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    const { getCms, CmsUnavailableError } = await import('./cms');

    await expect(getCms('faq', { locale: 'ru' })).rejects.toBeInstanceOf(CmsUnavailableError);
    expect(errorLines().some((l) => l.startsWith('[cms] ALERT:'))).toBe(true);
  });

  it('отмечает отказ в хранилище запроса — обёртка сервера отдаст 503', async () => {
    stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    const { AsyncLocalStorage } = await import('node:async_hooks');
    const { CMS_OUTAGE_SYMBOL } = await import('./cms-outage');
    const storage = new AsyncLocalStorage<{ outage?: { resource: string } }>();
    (globalThis as Record<symbol, unknown>)[CMS_OUTAGE_SYMBOL] = storage;
    const { getCms } = await import('./cms');

    const store: { outage?: { resource: string } } = {};
    await storage.run(store, () => getCms('faq', { locale: 'ru' }).catch(() => undefined));
    expect(store.outage).toEqual({ resource: 'faq' });
    delete (globalThis as Record<symbol, unknown>)[CMS_OUTAGE_SYMBOL];
  });
});

describe('CMS не настроена', () => {
  it('CMS_API_URL пуст → в сеть не ходим и фикстур нет: ошибка', async () => {
    vi.stubEnv('CMS_API_URL', '');
    const mock = stubFetch(() => Promise.reject(new Error('сети быть не должно')));
    const { getCms } = await import('./cms');

    await expect(getCms('brand', { locale: 'ru' })).rejects.toThrow(/CMS_API_URL/);
    expect(mock).not.toHaveBeenCalled();
  });

  it('SITE_SLUG пуст → в CMS НЕ ходим (PKG-05: без слага — чужой сайт)', async () => {
    vi.stubEnv('SITE_SLUG', '');
    const mock = stubFetch(() => Promise.resolve(Response.json({ name: 'чужой' })));
    const { getCms } = await import('./cms');

    await expect(getCms('brand', { locale: 'ru' })).rejects.toThrow(/SITE_SLUG/);
    expect(mock).not.toHaveBeenCalled();
  });

  it('слаг уходит в запрос как есть', async () => {
    vi.stubEnv('SITE_SLUG', 'apex-uk');
    const mock = stubFetch(() => Promise.reject(new Error('ECONNREFUSED')));
    const { getCms } = await import('./cms');
    await getCms('brand', { locale: 'ru' }).catch(() => undefined);

    const url = String((mock.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('site=apex-uk');
  });
});

describe('списки страниц для сборки', () => {
  it('CMS не настроена → пустой список (страницы по первому запросу), без запроса', async () => {
    vi.stubEnv('CMS_API_URL', '');
    const { staticParamsFromCms } = await import('./cms');
    const load = vi.fn(async () => [{ slug: 'x' }]);
    expect(await staticParamsFromCms(load)).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it('CMS настроена, но не ответила → пустой список, сборка не падает', async () => {
    const { staticParamsFromCms } = await import('./cms');
    expect(await staticParamsFromCms(async () => Promise.reject(new Error('down')))).toEqual([]);
  });
});

/**
 * Бренд v2 (Р-040): строгая схема отвергла бы ответ из-за одного пустого
 * поля. Раньше это давало чужой бренд из фикстуры, теперь — ошибку; оба
 * исхода плохи, поэтому бренд разбирается мягко по полям.
 */
describe('бренд из CMS v2', () => {
  it('primaryColor: null → бренд остаётся боевым', async () => {
    stubFetch(() =>
      Promise.resolve(
        Response.json({ name: 'Из CMS v2', logo: null, favicon: null, primaryColor: null, socials: [] }),
      ),
    );
    const { getCms } = await import('./cms');
    const brand = await getCms('brand', { locale: 'ru' });

    expect(brand.name).toBe('Из CMS v2');
    expect(brand.primaryColor).toBeNull();
  });
});
