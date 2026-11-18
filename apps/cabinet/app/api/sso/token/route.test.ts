import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 20_000 });

const issueHandoffToken = vi.hoisted(() =>
  vi.fn(async () => ({ token: 'signed.jwt.token', expiresIn: 60 })),
);
const getSessionUser = vi.hoisted(() => vi.fn());
const terminalLeverageFor = vi.hoisted(() => vi.fn(async (): Promise<number | null> => 10));

vi.mock('@/lib/sso/jwt', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sso/jwt')>('@/lib/sso/jwt');
  return { ...actual, issueHandoffToken };
});
vi.mock('@/lib/auth/session', () => ({ getSessionUser }));
vi.mock('@/lib/leverage', () => ({ terminalLeverageFor }));
const FEES = { markupBps: 15, commissionBps: 0 };
const terminalFeesFor = vi.hoisted(() => vi.fn(async () => ({ markupBps: 15, commissionBps: 0 })));
vi.mock('@/lib/fees', () => ({ terminalFeesFor }));

const USER = { id: 'user-1', uid: 1, email: 'a@b.c', fullName: 'A', locale: 'ru', vipLevel: 0 };

async function post() {
  const { POST } = await import('./route');
  return POST(new Request('http://cabinet.test/api/sso/token', { method: 'POST' }));
}

beforeEach(async () => {
  vi.resetModules();
  issueHandoffToken.mockClear().mockResolvedValue({ token: 'signed.jwt.token', expiresIn: 60 });
  getSessionUser.mockReset().mockResolvedValue(USER);
  terminalLeverageFor.mockReset().mockResolvedValue(10);
  vi.stubEnv('SSO_PRIVATE_KEY_B64', 'ZmFrZS1rZXk=');
  vi.stubEnv('SITE_SLUG', 'apex-ru');
  const { __resetRateLimit } = await import('@/lib/rate-limit');
  __resetRateLimit();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/sso/token · живая сессия', () => {
  it('сессия жива → токен выпущен', async () => {
    const res = await post();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ tenant: 'apex-ru', expiresIn: 60 });
  });

  it('CAB-07 · срок берётся ОТ ВЫПУСКА, а не повторяется константой', async () => {
    issueHandoffToken.mockResolvedValue({ token: 'signed.jwt.token', expiresIn: 42 });

    const res = await post();

    await expect(res.json()).resolves.toMatchObject({ expiresIn: 42 });
  });

  it('CAB-07 · выпуск без срока → 503 с названным кодом, токен не отдан', async () => {
    const { TokenWithoutExpiryError } = await import('@/lib/sso/jwt');
    issueHandoffToken.mockRejectedValue(new TokenWithoutExpiryError('exp'));

    const res = await post();

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: 'token_without_expiry' });
    expect(body.token).toBeUndefined();
  });

  it('погашенная сессия НЕ выпускает токен', async () => {
    getSessionUser.mockResolvedValue(null);

    const res = await post();

    expect(res.status).toBe(401);
    expect(issueHandoffToken).not.toHaveBeenCalled();
  });

  it('ключа нет → 503 и тоже ни одной чеканки', async () => {
    vi.stubEnv('SSO_PRIVATE_KEY_B64', '');

    const res = await post();

    expect(res.status).toBe(503);
    expect(issueHandoffToken).not.toHaveBeenCalled();
  });

  it('ненастроенность проверяется ДО сессии — ручка не ходит в базу зря', async () => {
    vi.stubEnv('SSO_PRIVATE_KEY_B64', '');

    await post();

    expect(getSessionUser).not.toHaveBeenCalled();
  });
});

describe('POST /api/sso/token · ограничение частоты', () => {
  it('срабатывает: 31-й выпуск в окне отказан, и токен не чеканится', async () => {
    for (let i = 0; i < 30; i += 1) {
      expect((await post()).status).toBe(200);
    }
    issueHandoffToken.mockClear();

    const res = await post();

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ error: 'rateLimited' });
    expect(issueHandoffToken).not.toHaveBeenCalled();
  });

  it('счёт ведётся по пользователю, а не на всю ручку', async () => {
    for (let i = 0; i < 30; i += 1) await post();
    expect((await post()).status).toBe(429);

    getSessionUser.mockResolvedValue({ ...USER, id: 'user-2' });

    expect((await post()).status).toBe(200);
  });

  it('отказанная попытка не чеканит и не продлевает блокировку молча', async () => {
    for (let i = 0; i < 31; i += 1) await post();
    const calls = issueHandoffToken.mock.calls.length;

    await post();

    expect(issueHandoffToken.mock.calls.length).toBe(calls);
    expect(calls).toBe(30);
  });
});

describe('POST /api/sso/token · выбор счёта (account_kind, 09.11)', () => {
  async function postWith(query: string) {
    const { POST } = await import('./route');
    return POST(new Request(`http://cabinet.test/api/sso/token${query}`, { method: 'POST' }));
  }

  it('без параметра — демо (как раньше)', async () => {
    const res = await postWith('');
    expect(res.status).toBe(200);
    expect(issueHandoffToken).toHaveBeenCalledWith('user-1', 'demo', 10, FEES);
  });

  it('?account=real — токен с account_kind=real', async () => {
    const res = await postWith('?account=real');
    expect(res.status).toBe(200);
    expect(issueHandoffToken).toHaveBeenCalledWith('user-1', 'real', 10, FEES);
    await expect(res.json()).resolves.toMatchObject({ accountKind: 'real' });
  });

  it('неизвестный счёт — 400, токен не выпущен', async () => {
    const res = await postWith('?account=vip');
    expect(res.status).toBe(400);
    expect(issueHandoffToken).not.toHaveBeenCalled();
  });

  it('заблокированный (сессии нет) не получает и реальный — 401', async () => {
    getSessionUser.mockResolvedValue(null);
    const res = await postWith('?account=real');
    expect(res.status).toBe(401);
    expect(issueHandoffToken).not.toHaveBeenCalled();
  });
});

describe('POST /api/sso/token · плечо счёта (claim leverage, Р-446)', () => {
  it('плечо клиента уходит в выпуск токена', async () => {
    const res = await post();

    expect(res.status).toBe(200);
    expect(terminalLeverageFor).toHaveBeenCalledWith(USER.id);
    expect(issueHandoffToken).toHaveBeenCalledWith(USER.id, 'demo', 10, FEES);
  });

  it('конфигурация плеча клиенту ничего не задаёт — токен без claim-а', async () => {
    terminalLeverageFor.mockResolvedValue(null);

    const res = await post();

    expect(res.status).toBe(200);
    expect(issueHandoffToken).toHaveBeenCalledWith(USER.id, 'demo', null, FEES);
  });

  it('плечо не прочиталось — 503 leverage_unavailable, токен НЕ выпущен', async () => {
    terminalLeverageFor.mockRejectedValue(new Error('db down'));

    const res = await post();

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'leverage_unavailable' });
    expect(issueHandoffToken).not.toHaveBeenCalled();
  });
});

describe('POST /api/sso/token · тариф счёта (claims markup_bps/commission_bps)', () => {
  it('тариф не прочитался — токен всё равно выпускается, без claim тарифа', async () => {
    terminalFeesFor.mockRejectedValueOnce(new Error('db down'));
    const res = await post();
    expect(res.status).toBe(200);
    expect(issueHandoffToken).toHaveBeenCalledWith(USER.id, 'demo', 10, null);
  });
});
