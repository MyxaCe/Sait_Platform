import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const IDLE = { state: 'idle' } as const;

describe('WEB-29 · сброс идёт через терминал', () => {
  it('зовёт ручку терминала для пользователя из СЕССИИ', async () => {
    const { resetDemoAccountAction } = await import('./actions');
    await resetDemoAccountAction(IDLE);

    expect(reset.calls).toEqual(['user-1']);
  });

  it('денежной таблицы не касается при успехе', async () => {
    const { resetDemoAccountAction } = await import('./actions');
    await resetDemoAccountAction(IDLE);

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
    await resetDemoAccountAction(IDLE);

    expect(touchesMoney()).toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it('отказ «не дошли» и отказ «нельзя» различимы в логе', async () => {
    const { resetDemoAccountAction } = await import('./actions');

    reset.outcome = { state: 'unavailable', reason: 'network' };
    await resetDemoAccountAction(IDLE);
    const first = vi.mocked(console.error).mock.calls.map(String).join(' ');

    vi.mocked(console.error).mockClear();
    reset.outcome = { state: 'refused', reason: 'account_not_flat', raw: 'account_not_flat' };
    await resetDemoAccountAction(IDLE);
    const second = vi.mocked(console.error).mock.calls.map(String).join(' ');

    expect(first).not.toBe(second);
    expect(second).toContain('account_not_flat');
  });
});

describe('WEB-42 · исход виден ЧЕЛОВЕКУ, а не только логу', () => {
  const IDLE = { state: 'idle' } as const;

  it('принято — это «принято», а НЕ «сброшено»', async () => {
    const { resetDemoAccountAction } = await import('./actions');

    expect(await resetDemoAccountAction(IDLE)).toEqual({ state: 'accepted' });
  });

  it.each([
    ['есть позиции', 'account_not_flat'],
    ['не демо-счёт', 'not_a_demo_account'],
  ])('%s → причина доходит до человека по имени', async (_n, reason) => {
    reset.outcome = { state: 'refused', reason, raw: reason };

    const { resetDemoAccountAction } = await import('./actions');

    expect(await resetDemoAccountAction(IDLE)).toEqual({ state: 'refused', reason });
  });

  it('незнакомая причина → отказ назван отказом, причина пустая', async () => {
    reset.outcome = { state: 'refused', reason: null, raw: 'nechto_novoe' };

    const { resetDemoAccountAction } = await import('./actions');

    expect(await resetDemoAccountAction(IDLE)).toEqual({ state: 'refused', reason: null });
  });

  it('не дошли → это ДРУГОЙ исход, а не отказ по существу', async () => {
    reset.outcome = { state: 'unavailable', reason: 'network' };

    const { resetDemoAccountAction } = await import('./actions');
    const got = await resetDemoAccountAction(IDLE);

    expect(got).toEqual({ state: 'unavailable', reason: 'network' });
    expect(got.state).not.toBe('refused');
  });

  it('слишком часто → НАЗВАНО, а не третья тишина подряд', async () => {
    const { resetDemoAccountAction } = await import('./actions');

    for (let i = 0; i < 5; i += 1) await resetDemoAccountAction(IDLE);
    expect(await resetDemoAccountAction(IDLE)).toEqual({ state: 'too-often' });
  });

  it('исходы различимы между собой — иначе показывать нечего', async () => {
    const { resetDemoAccountAction } = await import('./actions');

    reset.outcome = { state: 'accepted' };
    const ok = await resetDemoAccountAction(IDLE);
    reset.outcome = { state: 'refused', reason: 'account_not_flat', raw: 'account_not_flat' };
    const no = await resetDemoAccountAction(IDLE);
    reset.outcome = { state: 'unavailable', reason: 'http-error' };
    const away = await resetDemoAccountAction(IDLE);

    expect(new Set([ok.state, no.state, away.state]).size).toBe(3);
  });
});
