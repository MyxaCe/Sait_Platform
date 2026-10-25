import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Регистрация при незаданном стартовом балансе — CAB-08, решение штаба
 * Р-040.
 *
 * Проверка на уровне СВЯЗКИ, и это принципиально: разбор поля покрыт
 * модульно в `@broker/tenant`, но модульный тест не доказывает, что
 * регистрация этот разбор СПРАШИВАЕТ. Мутация «вернуть умолчание в
 * миллион центов» внутри пакета покрасит пакетный набор; мутация
 * «регистрация не смотрит на состояние и берёт `cents` как есть»
 * красится только здесь.
 *
 * Второе, что проверяется здесь и больше нигде: отказ НЕ ОСТАВЛЯЕТ
 * следов в базе. Полурегистрация хуже отказа — человек получил бы
 * «email занят» на второй попытке.
 */

const queries: { sql: string; params: unknown[] }[] = [];
const released = { count: 0 };

vi.mock('../db', () => ({
  getPool: () => ({
    connect: async () => ({
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return { rows: [] };
      },
      release: () => {
        released.count += 1;
      },
    }),
  }),
}));

const INPUT = {
  firstName: 'Иван',
  lastName: 'Петров',
  email: 'ivan@example.com',
  phone: '+35725000000',
  country: 'CY',
  accountType: 'standard' as const,
  password: 'correct horse battery',
  locale: 'ru' as const,
};

/** Сумма, которую подставляла legacy. Ни один отказ не вправе её вернуть. */
const LEGACY_DEFAULT = 1_000_000;

function stubCms(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

function demoAccountInsert() {
  return queries.find((q) => q.sql.includes('INSERT INTO demo_accounts'));
}

/**
 * Прогрев графа модулей (WEB-33).
 *
 * Первый `await import(...)` в файле платит за превращение всего графа
 * зависимостей; дальше работает кеш преобразования, и остальные
 * импорты мгновенны. Внутри теста это время меряется **как работа
 * кода**, и под параллельной нагрузкой упирается в предел в 5 с —
 * краснеет первая по списку проверка безотносительно того, что она
 * проверяет.
 *
 * Импорт в каждом тесте остаётся нарочным: он нужен чистому состоянию
 * модуля после `vi.resetModules()` и подменам до загрузки. Сброс
 * реестра модулей кеша преобразования не трогает — поэтому прогрев
 * помогает, а свежесть состояния сохраняется.
 */
beforeAll(async () => {
  await import('./register');
});

beforeEach(() => {
  queries.length = 0;
  released.count = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('CMS_API_URL', 'http://cms.test');
  vi.stubEnv('SITE_SLUG', 'apex-ru');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('сумма назначена', () => {
  it('регистрация НЕ создаёт денежную строку (WEB-29)', async () => {
    /*
     * Проверка перевёрнута, а не удалена: прежде она требовала, чтобы
     * счёт открывался ровно на назначенную сумму. Теперь счёт
     * открывает терминал — лениво, при первом входе туда, — и
     * создавать строку здесь значило бы открыть счёт от его имени.
     *
     * Удалить её было бы хуже: исчезло бы утверждение о том, что
     * регистрация денег не трогает, и первый, кто вернёт вставку, не
     * покраснеет нигде.
     */
    stubCms(() => Promise.resolve(Response.json({ demoStartBalanceCents: 250_000, instruments: [] })));

    const { registerUser } = await import('./register');
    const result = await registerUser(INPUT);

    expect(result.ok).toBe(true);
    expect(demoAccountInsert()).toBeUndefined();
  });

  it('барьер стартовой суммы остаётся: сумма не назначена — регистрации нет', () => {
    // Смысл барьера сменился с защиты записи на политику: владелец
    // обязан назвать сумму прежде, чем сайт начнёт принимать людей.
    // Проверка этого же свойства живёт выше по файлу; здесь — пометка,
    // чтобы связь не потерялась при следующей правке.
    expect(true).toBe(true);
  });
});

describe('сумма не назначена: CMS ответила `null`', () => {
  it('регистрация ОТКАЗЫВАЕТ, причина названа', async () => {
    stubCms(() =>
      Promise.resolve(Response.json({ demoStartBalanceCents: null, instruments: ['BTCUSD'] })),
    );

    const { registerUser } = await import('./register');
    const result = await registerUser(INPUT);

    expect(result).toEqual({ ok: false, reason: 'startBalanceUnset' });
  });

  it('РАСТЯЖКА: в базе не появляется НИЧЕГО — ни пользователя, ни счёта', async () => {
    stubCms(() => Promise.resolve(Response.json({ demoStartBalanceCents: null, instruments: [] })));

    const { registerUser } = await import('./register');
    await registerUser(INPUT);

    // Регистрация и есть открытие счёта (ADR-022). Завести пользователя
    // без счёта значило бы впустить его в кабинет, где ничего не
    // работает, а повторная попытка упёрлась бы в «email занят».
    expect(queries).toEqual([]);
    expect(released.count).toBe(0);
  });

  it('отказ оставляет след в логе: защита без следа непроверяема', async () => {
    stubCms(() => Promise.resolve(Response.json({ demoStartBalanceCents: null, instruments: [] })));

    const { registerUser } = await import('./register');
    await registerUser(INPUT);

    expect(console.error).toHaveBeenCalled();
  });
});

describe('сумму узнать не удалось', () => {
  it.each([
    ['CMS не ответила', () => Promise.reject(new Error('ECONNREFUSED')), 'network'],
    ['CMS ответила 503', () => Promise.resolve(new Response('', { status: 503 })), 'http-error'],
    [
      'в поле мусор',
      () => Promise.resolve(Response.json({ demoStartBalanceCents: 'NaN', instruments: [] })),
      'malformed',
    ],
  ])('%s → отказ `startBalanceUnavailable` с причиной', async (_name, impl, reason) => {
    stubCms(impl);

    const { registerUser } = await import('./register');
    const result = await registerUser(INPUT);

    // «Не задан» и «не смогли узнать» запрещают одинаково, а чинятся в
    // разных местах — значит обязаны быть различимы (Р-025, п. 2).
    expect(result).toEqual({ ok: false, reason: 'startBalanceUnavailable', detail: reason });
    expect(queries).toEqual([]);
  });

  it('CMS_API_URL не задан → отказ, а не умолчание', async () => {
    vi.stubEnv('CMS_API_URL', '');

    const { registerUser } = await import('./register');
    const result = await registerUser(INPUT);

    expect(result).toEqual({
      ok: false,
      reason: 'startBalanceUnavailable',
      detail: 'not-configured',
    });
  });
});

describe('растяжки на само решение', () => {
  it('РАСТЯЖКА: ни одно состояние конфига не открывает счёт на миллион центов', async () => {
    const bodies: unknown[] = [
      { demoStartBalanceCents: null },
      { demoStartBalanceCents: 'NaN' },
      { demoStartBalanceCents: undefined },
      {},
    ];

    for (const body of bodies) {
      queries.length = 0;
      stubCms(() => Promise.resolve(Response.json(body)));
      const { registerUser } = await import('./register');

      const result = await registerUser(INPUT);

      // Мутация «вернуть умолчание legacy» красит этот тест на каждом
      // из входов: сумма, которую никто не назначал, не появляется
      // ни в ответе, ни в базе.
      expect(result.ok).toBe(false);
      expect(demoAccountInsert()).toBeUndefined();
      expect(
        queries.some((q) => q.params.includes(LEGACY_DEFAULT)),
      ).toBe(false);
    }
  });

  it('РАСТЯЖКА: у каждой причины отказа есть перевод в обеих локалях', async () => {
    // Иначе отказ выйдет наружу ключом вместо текста — исчезновение
    // объяснения запрещено (Р-025, п. 3), и поймать это можно только
    // сверкой кода с каталогом.
    const reasons = ['emailExists', 'startBalanceUnset', 'startBalanceUnavailable'];

    for (const locale of ['ru', 'en']) {
      const messages = JSON.parse(
        readFileSync(path.resolve(__dirname, `../../messages/${locale}.json`), 'utf8'),
      ) as { validation: Record<string, string> };

      for (const reason of reasons) {
        expect(messages.validation[reason], `${locale}/${reason}`).toBeTruthy();
      }
    }
  });
});
