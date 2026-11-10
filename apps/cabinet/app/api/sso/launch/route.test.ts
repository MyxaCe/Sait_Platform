import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Вход в терминал верхним уровнем (sso-pack v1.1) — барьеры `/api/sso/launch`.
 *
 * Главное здесь — **наблюдаемое «токен не выпущен»** (`issueHandoffToken` не
 * вызывался), а не только код ответа: открытый редирект с подписанным
 * токеном во фрагменте — это раздача входа в чужие руки.
 */
vi.setConfig({ testTimeout: 20_000 });

const issueHandoffToken = vi.hoisted(() => vi.fn(async () => ({ token: 'signed.jwt.token', expiresIn: 60 })));
const getSessionUser = vi.hoisted(() => vi.fn());
const terminalLeverageFor = vi.hoisted(() => vi.fn(async (): Promise<number | null> => 10));
const terminalFeesFor = vi.hoisted(() => vi.fn(async () => ({ markupBps: 15, commissionBps: 0 })));

vi.mock('@/lib/sso/jwt', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sso/jwt')>('@/lib/sso/jwt');
  return { ...actual, issueHandoffToken };
});
vi.mock('@/lib/auth/session', () => ({ getSessionUser }));
vi.mock('@/lib/leverage', () => ({ terminalLeverageFor }));
vi.mock('@/lib/fees', () => ({ terminalFeesFor }));

const USER = { id: 'user-1', uid: 1, email: 'a@b.c', fullName: 'A', locale: 'ru', vipLevel: 0 };
const TERMINAL = 'https://terminal.example.com';
const RETURN = `${TERMINAL}/?site=apex-ru`;

async function launch(query: Record<string, string>) {
  const { GET } = await import('./route');
  return GET(new Request(`http://cabinet.test/api/sso/launch?${new URLSearchParams(query).toString()}`));
}

beforeEach(async () => {
  vi.resetModules();
  issueHandoffToken.mockClear().mockResolvedValue({ token: 'signed.jwt.token', expiresIn: 60 });
  getSessionUser.mockReset().mockResolvedValue(USER);
  terminalLeverageFor.mockReset().mockResolvedValue(10);
  terminalFeesFor.mockClear();
  vi.stubEnv('SSO_PRIVATE_KEY_B64', 'ZmFrZS1rZXk=');
  vi.stubEnv('SITE_SLUG', 'apex-ru');
  vi.stubEnv('TERMINAL_ORIGINS', `${TERMINAL}, https://terminal-b.example.com`);
  const { __resetRateLimit } = await import('@/lib/rate-limit');
  __resetRateLimit();
});

afterEach(() => vi.unstubAllEnvs());

describe('GET /api/sso/launch · открытый редирект отвергнут', () => {
  it.each([
    ['чужой хост', 'https://evil.example/?site=apex-ru'],
    ['поддомен-похожий', 'https://terminal.example.com.evil.example/'],
    ['другой порт', 'https://terminal.example.com:8443/'],
    ['другая схема', 'http://terminal.example.com/'],
    ['учётные данные в URL', 'https://user:pw@terminal.example.com/'],
    ['javascript:', 'javascript:alert(1)'],
    ['относительный', '/evil'],
    ['пусто', ''],
  ])('%s → 400, токен не выпущен', async (_n, ret) => {
    const res = await launch({ account: 'demo', return: ret });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_return' });
    expect(issueHandoffToken).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toBeNull();
  });

  it('список origin не задан — по умолчанию origin NEXT_PUBLIC_TERMINAL_URL', async () => {
    vi.stubEnv('TERMINAL_ORIGINS', '');
    vi.stubEnv('NEXT_PUBLIC_TERMINAL_URL', `${TERMINAL}/app`);
    expect((await launch({ account: 'demo', return: RETURN })).status).toBe(302);
    vi.stubEnv('NEXT_PUBLIC_TERMINAL_URL', '');
    expect((await launch({ account: 'demo', return: RETURN })).status).toBe(400);
  });

  it('незнакомый account → 400', async () => {
    const res = await launch({ account: 'vip', return: RETURN });
    expect(res.status).toBe(400);
    expect(issueHandoffToken).not.toHaveBeenCalled();
  });
});

describe('GET /api/sso/launch · сессия', () => {
  it('нет сессии → логин кабинета с продолжением в этот же launch', async () => {
    getSessionUser.mockResolvedValue(null);
    const res = await launch({ account: 'real', return: RETURN, lang: 'en' });
    expect(res.status).toBe(302);
    const loc = res.headers.get('location')!;
    expect(loc.startsWith('/en/login?next=')).toBe(true);
    const next = new URLSearchParams(loc.split('?').slice(1).join('?')).get('next')!;
    expect(next.startsWith('/api/sso/launch?')).toBe(true);
    expect(new URLSearchParams(next.split('?')[1]).get('return')).toBe(RETURN);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(issueHandoffToken).not.toHaveBeenCalled();
  });

  it('заблокированный клиент (сессии для него нет — ADM-02) → токен не выпущен', async () => {
    // `getSessionUser` возвращает null для блока (см. app/api/sso/token/blocked.test.ts).
    getSessionUser.mockResolvedValue(null);
    const res = await launch({ account: 'demo', return: RETURN });
    expect(res.headers.get('location') ?? '').not.toContain('handoff');
    expect(issueHandoffToken).not.toHaveBeenCalled();
  });

  it('rate limit — общий с /api/sso/token', async () => {
    const { isRateLimited } = await import('@/lib/rate-limit');
    for (let i = 0; i < 30; i++) isRateLimited('sso:user-1', 30, 60_000);
    const res = await launch({ account: 'demo', return: RETURN });
    expect(res.status).toBe(429);
    expect(issueHandoffToken).not.toHaveBeenCalled();
  });

  it('плечо не прочитано → 503, токена нет (fail-closed, Р-446)', async () => {
    terminalLeverageFor.mockRejectedValue(new Error('db'));
    const res = await launch({ account: 'demo', return: RETURN });
    expect(res.status).toBe(503);
    expect(issueHandoffToken).not.toHaveBeenCalled();
  });

  it('SSO не настроен → 503', async () => {
    vi.stubEnv('SSO_PRIVATE_KEY_B64', '');
    const res = await launch({ account: 'demo', return: RETURN });
    expect(res.status).toBe(503);
    expect(issueHandoffToken).not.toHaveBeenCalled();
  });
});

describe('GET /api/sso/launch · выпуск', () => {
  it('302 → return#handoff=…&account=…&lang=…, no-store; те же claims, что у /api/sso/token', async () => {
    const res = await launch({ account: 'real', return: `${RETURN}#old=fragment`, lang: 'en' });
    expect(res.status).toBe(302);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const loc = res.headers.get('location')!;
    const [base, frag] = loc.split('#');
    expect(base).toBe(RETURN);
    const f = new URLSearchParams(frag);
    expect(f.get('handoff')).toBe('signed.jwt.token');
    expect(f.get('account')).toBe('real');
    expect(f.get('lang')).toBe('en');
    expect(base).not.toContain('signed.jwt.token'); // токен только во фрагменте
    expect(issueHandoffToken).toHaveBeenCalledWith('user-1', 'real', 10, { markupBps: 15, commissionBps: 0 });
  });

  it('lang не передан — язык профиля клиента; без account — demo', async () => {
    const res = await launch({ return: RETURN });
    const f = new URLSearchParams(res.headers.get('location')!.split('#')[1]);
    expect(f.get('account')).toBe('demo');
    expect(f.get('lang')).toBe('ru');
  });
});
