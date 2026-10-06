import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Сброс демо-счёта при незаданной стартовой сумме — CAB-05, Р-040.
 *
 * Второе место, где число из CMS становится деньгами на счёте, и оно
 * опаснее первого: регистрация создаёт счёт, а сброс ПЕРЕЗАПИСЫВАЕТ
 * существующий баланс. Умолчание в отображении — косметика; умолчание
 * на входе записи в счёт — авария.
 *
 * Барьер проверяется именно здесь, а не в интерфейсе: кнопка
 * задизейблена с подписью, но серверный экшен вызывается запросом, а не
 * кнопкой. Проверка интерфейса доказывала бы соседнее.
 */

const queries: { sql: string; params: unknown[] }[] = [];

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/headers', () => ({ headers: () => new Map() }));
vi.mock('next/navigation', () => ({ redirect: () => {} }));
vi.mock('./db', () => ({
  getPool: () => ({
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return { rows: [] };
    },
  }),
}));
vi.mock('./auth/session', () => ({
  getSessionUser: async () => ({ id: 'user-1', email: 'u@example.com' }),
  createSession: async () => {},
  destroyCurrentSession: async () => {},
  revokeSession: async () => {},
}));

beforeEach(() => {
  queries.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('CMS_API_URL', 'http://cms.test');
  vi.stubEnv('SITE_SLUG', 'apex-ru');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

function stubCms(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

const balanceUpdate = () => queries.find((q) => q.sql.includes('UPDATE demo_accounts'));

describe('сумма назначена', () => {
  it('баланс сбрасывается ровно к ней', async () => {
    stubCms(() => Promise.resolve(Response.json({ demoStartBalanceCents: 250_000 })));

    const { resetDemoAccountAction } = await import('./actions');
    await resetDemoAccountAction();

    expect(balanceUpdate()?.params[0]).toBe(250_000);
  });
});

describe('суммы нет', () => {
  it.each([
    ['CMS ответила null', () => Promise.resolve(Response.json({ demoStartBalanceCents: null }))],
    ['CMS не ответила', () => Promise.reject(new Error('ECONNREFUSED'))],
    ['в поле мусор', () => Promise.resolve(Response.json({ demoStartBalanceCents: 'NaN' }))],
  ])('%s → РАСТЯЖКА: баланса никто не касается', async (_name, impl) => {
    stubCms(impl);

    const { resetDemoAccountAction } = await import('./actions');
    await resetDemoAccountAction();

    // Записать в счёт число, которого никто не назначал, — та же ошибка,
    // что открыть на нём счёт, только поверх живого баланса клиента.
    expect(balanceUpdate()).toBeUndefined();
    expect(queries).toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });
});
