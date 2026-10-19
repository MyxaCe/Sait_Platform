import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WEB-07: граница доступа витрины вычисляется в РАНТАЙМЕ, а не на сборке.
 *
 * **Дефект.** Fail-closed спас разрешение и не спас диагноз: после
 * пересборки витрина говорила «список недоступен, это сбой платформы»
 * вместо «инструменты не выбраны» — и отправляла чинить то, что не
 * сломано. `CMS_API_URL` рантаймовая, на сборке её нет, состояние
 * «не настроено» замерзало в готовой разметке. В образе лежал HTML с
 * диагнозом сборки, а `/api/health` того же контейнера в тот же момент
 * показывал переменную заданной.
 *
 * **Почему проверки такие странные — они про ПРОВОДКУ, а не про логику.**
 * Решение о доступе исправно и покрыто в `@broker/tenant`; дефект жил не
 * в нём, а в том, ГДЕ и КОГДА его зовут. Класс «написано и не
 * вызывается» (и зеркальный ему «вызывается не там») модульными тестами
 * не ловится в принципе: функция-то работает. Снятие компонента с экрана
 * и перенос вызова в другой сегмент не красят ни одного обычного теста —
 * ни типы, ни линтер этого не видят.
 *
 * Отдельно про вызов из общего макета: он не ломает поведение, он меняет
 * ЧИСЛО СТАТИЧЕСКИХ СТРАНИЦ со 88 на 0 — и проявляется только в выводе
 * `next build`, который в CI никто не читает глазами. Поэтому он
 * закреплён здесь.
 *
 * Полная проверка пути — числа `next build` до и после и живой прогон
 * с поддельной CMS — в `docs/Журнал багов.md#B-026`.
 *
 * **Мутация, которую покрасить нечем** (названа вслух, чтобы следующий не
 * «дозакрывал» её бесполезной проверкой): перенос `noStore()` на строку
 * ниже, между чтением `process.env` и запросом. Чтение окружения
 * синхронно, `await` между ними нет — сегмент тот же самый, и поведение
 * не меняется. Красить тут нечего; значение имеет только порядок
 * «`noStore()` раньше первого `await`», и он закреплён отдельно.
 */

const WEB = path.resolve(__dirname, '..');
const read = (relative: string) => readFileSync(path.join(WEB, relative), 'utf8');

/**
 * Код без комментариев. Нужно потому, что отсутствие вызова проверяется
 * поиском по тексту, а объяснение, ПОЧЕМУ вызова здесь нет, обязано
 * лежать рядом с кодом и называть функцию по имени. Без этого пришлось
 * бы выбирать между проверяемым правилом и записанным намерением.
 */
const code = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const MARKETING_LAYOUT = 'app/[locale]/(marketing)/layout.tsx';
const ACCESS_ROUTE = 'app/api/tenant/access/route.ts';
const INSTRUMENTS_PAGE = 'app/[locale]/(marketing)/instruments/page.tsx';
const DETAIL_PAGE = 'app/[locale]/(marketing)/instruments/[category]/[symbol]/page.tsx';

/* ------------------------------------------------------------------ */
/* 1. Сам адаптер: решение не имеет права замёрзнуть в образе           */
/* ------------------------------------------------------------------ */

const noStore = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ unstable_noStore: noStore }));

describe('getTenantAccess · рантайм, а не сборка', () => {
  beforeEach(() => {
    noStore.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('SITE_SLUG', 'apex-ru');
    vi.stubEnv('CMS_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('помечает рендер рантаймовым — иначе причина выводится из условий сборки', async () => {
    vi.stubEnv('CMS_API_URL', 'http://cms.test');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ instruments: ['BTCUSD'] }))));
    const { getTenantAccess } = await import('./tenant');

    await getTenantAccess();

    expect(noStore).toHaveBeenCalled();
  });

  it('помечает ДО того, как узнает, что CMS не настроена', async () => {
    // Ровно состояние сборки: переменной нет, в сеть не идём, вердикт
    // `not-configured`. Если пометить после этой ветки, он и замёрзнет —
    // то есть пометка не сработает именно в том случае, ради которого
    // написана.
    vi.stubEnv('CMS_API_URL', '');
    const { getTenantAccess } = await import('./tenant');

    const access = await getTenantAccess();

    expect(access).toEqual({ state: 'unavailable', reason: 'not-configured' });
    expect(noStore).toHaveBeenCalled();
  });

  it('пометка стоит раньше запроса к CMS, а не после него', async () => {
    // Порядок — часть поведения: `noStore()` действует на сегмент,
    // который рендерится СЕЙЧАС, и после первого `await` рендер может
    // быть уже не наш.
    const order: string[] = [];
    noStore.mockImplementation(() => order.push('noStore'));
    vi.stubEnv('CMS_API_URL', 'http://cms.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        order.push('fetch');
        return Promise.resolve(Response.json({ instruments: ['BTCUSD'] }));
      }),
    );
    const { getTenantAccess } = await import('./tenant');

    await getTenantAccess();

    expect(order).toEqual(['noStore', 'fetch']);
  });

  it('редакционное окно и теги вебхука ПЕРЕЖИЛИ починку', async () => {
    // Растяжка. Чинился диагноз; окно переиспользования ответа CMS
    // (ADR-009) и инвалидация вебхуком к дефекту отношения не имеют, и
    // `cache: 'no-store'` снёс бы их заодно — починка ценой свойства,
    // которое не ломалось.
    vi.stubEnv('CMS_API_URL', 'http://cms.test');
    const mock = vi.fn(() => Promise.resolve(Response.json({ instruments: ['BTCUSD'] })));
    vi.stubGlobal('fetch', mock);
    const { getTenantAccess } = await import('./tenant');

    await getTenantAccess();

    const init = (mock.mock.calls[0] as unknown[])[1] as {
      cache?: string;
      next?: { tags?: string[]; revalidate?: number };
    };
    expect(init.next?.tags).toEqual(['cms:brand', 'cms:brand:apex-ru']);
    expect(init.next?.revalidate).toBe(300);
    expect(init.cache).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* 2. Проводка: кто спрашивает границу и из какого сегмента             */
/* ------------------------------------------------------------------ */

describe('проводка границы по сегментам витрины', () => {
  it('общий макет границу НЕ спрашивает — иначе статики не остаётся вовсе', () => {
    // Строка тикера стоит на всех 156 страницах. Рантаймовый вопрос
    // отсюда увёл бы в динамику всю витрину, а она остаётся редакционной
    // границей (Р-030, п. 2). Проявилось бы это только числом в выводе
    // `next build` — то есть нигде.
    const layout = code(MARKETING_LAYOUT);

    expect(layout).not.toContain('getTenantAccess');
    expect(layout).toContain('<TickerGate');
  });

  it('островок тикера спрашивает границу у рантаймовой ручки', () => {
    // Снятие компонента с экрана не красит ни одного теста: ссылка без
    // записи в проводке не видна ни типам, ни линтеру.
    const gate = code('features/quotes/TickerGate.tsx');

    expect(gate).toContain("fetch('/api/tenant/access'");
    expect(gate).toContain("'use client'");
  });

  it('ручка границы объявлена динамической — GET без неё пререндерится', () => {
    // Тот же дефект, что B-010 у `/api/health`: статический GET отдавал
    // бы ответ сборки под видом ответа рантайма.
    expect(code(ACCESS_ROUTE)).toContain("export const dynamic = 'force-dynamic'");
  });

  it('страницы инструментов спрашивают границу НА СЕРВЕРЕ, а не в браузере', () => {
    // Там граница фильтрует содержимое, а не оформление: вынести этот
    // отбор в клиент значило бы отдать перечень в разметке и
    // ограничивать его картинкой.
    for (const page of [INSTRUMENTS_PAGE, DETAIL_PAGE]) {
      expect(code(page)).toContain('getTenantAccess');
    }
  });
});
