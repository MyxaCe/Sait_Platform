import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADM-02 · заблокированный клиент НЕ получает токен терминала.
 *
 * Соседний `route.test.ts` подменяет `getSessionUser` целиком — там барьер
 * «нет сессии → нет токена». Здесь сессия НАСТОЯЩАЯ (подменена только база и
 * кука): проверяем всю цепочку «строка `client_blocks.blocked` → сессия не
 * признана → токен не выпущен». Барьер, а не статус: решает то, что
 * `issueHandoffToken` не вызывался.
 */
vi.setConfig({ testTimeout: 20_000 });

const issueHandoffToken = vi.hoisted(() =>
  vi.fn(async () => ({ token: 'signed.jwt.token', expiresIn: 60 })),
);
const db = vi.hoisted(() => ({ blocked: false as boolean, sqls: [] as string[] }));

vi.mock('@/lib/sso/jwt', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sso/jwt')>('@/lib/sso/jwt');
  return { ...actual, issueHandoffToken };
});

vi.mock('@/lib/db', () => ({
  getPool: () => ({
    query: async (sql: string) => {
      db.sqls.push(sql);
      return {
        rows: [
          {
            id: 'user-1',
            uid: 100001,
            email: 'a@b.c',
            full_name: 'A',
            locale: 'ru',
            vip_level: 0,
            created_at: new Date(),
            blocked: db.blocked,
          },
        ],
      };
    },
  }),
}));

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => ({ value: 'live-session-token' }) }),
  headers: () => new Map(),
}));

async function post() {
  const { POST } = await import('./route');
  return POST();
}

beforeEach(async () => {
  vi.resetModules();
  issueHandoffToken.mockClear();
  db.blocked = false;
  db.sqls.length = 0;
  vi.stubEnv('SSO_PRIVATE_KEY_B64', 'ZmFrZS1rZXk=');
  vi.stubEnv('SITE_SLUG', 'apex-ru');
  const { __resetRateLimit } = await import('@/lib/rate-limit');
  __resetRateLimit();
});

describe('POST /api/sso/token · блокировка клиента', () => {
  it('заблокирован → 401, токен НЕ выпущен', async () => {
    db.blocked = true;
    const res = await post();

    expect(res.status).toBe(401);
    expect(issueHandoffToken).not.toHaveBeenCalled();
    expect(db.sqls.some((s) => /client_blocks/.test(s))).toBe(true);
  });

  it('разблокирован → токен выпущен', async () => {
    db.blocked = false;
    const res = await post();

    expect(res.status).toBe(200);
    expect(issueHandoffToken).toHaveBeenCalledTimes(1);
  });
});
