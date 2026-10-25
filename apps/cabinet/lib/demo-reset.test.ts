import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Сброс демо-счёта — операция ТЕРМИНАЛА (WEB-29).
 *
 * **Предмет проверки сменился целиком.** Прежде здесь доказывалось,
 * что кабинет не запишет в баланс число, которого никто не назначал
 * (CAB-08, Р-040). Теперь кабинет **не пишет баланс вообще**, и
 * доказывать надо другое: что он зовёт терминал и **не трогает
 * таблицу ни в одном исходе** — ни при успехе, ни при отказе.
 *
 * Прежний сброс ломался тише, чем выглядел: кабинет правил свою
 * копию, а следующее же событие о балансе возвращало прежнюю сумму —
 * **сброс отменялся сам**, и ничем это не краснело.
 *
 * Барьер проверяется здесь, а не в интерфейсе: кнопка задизейблена с
 * подписью, но серверный экшен вызывается запросом, а не кнопкой.
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

const touchesMoney = () =>
  queries.find((q) => /(?:INSERT\s+INTO|UPDATE)\s+demo_accounts/i.test(q.sql));

const reset = vi.hoisted(() => ({ calls: [] as string[], outcome: {} as unknown }));

vi.mock('./terminal/client', () => ({
  resetDemoAccount: async (userId: string) => {
    reset.calls.push(userId);
    return reset.outcome;
  },
}));

beforeEach(() => {
  reset.calls.length = 0;
  reset.outcome = { state: 'accepted' };
});

describe('WEB-29 · сброс идёт через терминал', () => {
  it('зовёт ручку терминала для пользователя из СЕССИИ', async () => {
    const { resetDemoAccountAction } = await import('./actions');
    await resetDemoAccountAction();

    // Из сессии, не из входных данных: иначе сброс чужого счёта.
    expect(reset.calls).toEqual(['user-1']);
  });

  it('денежной таблицы не касается при успехе', async () => {
    const { resetDemoAccountAction } = await import('./actions');
    await resetDemoAccountAction();

    // Новая сумма приедет событием. Записать её здесь значило бы
    // утверждать результат, которого мы не видели.
    expect(touchesMoney()).toBeUndefined();
  });

  it.each([
    ['терминал недоступен', { state: 'unavailable', reason: 'network' }],
    ['не демо-счёт', { state: 'refused', reason: 'not_a_demo_account', raw: 'not_a_demo_account' }],
    ['есть позиции', { state: 'refused', reason: 'account_not_flat', raw: 'account_not_flat' }],
    ['незнакомый отказ', { state: 'refused', reason: null, raw: 'nechto_novoe' }],
  ])('%s → таблицы не касаемся и ГОВОРИМ в лог', async (_name, outcome) => {
    reset.outcome = outcome;

    const { resetDemoAccountAction } = await import('./actions');
    await resetDemoAccountAction();

    expect(touchesMoney()).toBeUndefined();
    // Молчать нельзя: человек нажал и ждёт.
    expect(console.error).toHaveBeenCalled();
  });

  it('отказ «не дошли» и отказ «нельзя» различимы в логе', async () => {
    const { resetDemoAccountAction } = await import('./actions');

    reset.outcome = { state: 'unavailable', reason: 'network' };
    await resetDemoAccountAction();
    const first = vi.mocked(console.error).mock.calls.map(String).join(' ');

    vi.mocked(console.error).mockClear();
    reset.outcome = { state: 'refused', reason: 'account_not_flat', raw: 'account_not_flat' };
    await resetDemoAccountAction();
    const second = vi.mocked(console.error).mock.calls.map(String).join(' ');

    // Схлопнутые, они отправляют чинить наугад (Р-070).
    expect(first).not.toBe(second);
    expect(second).toContain('account_not_flat');
  });
});
