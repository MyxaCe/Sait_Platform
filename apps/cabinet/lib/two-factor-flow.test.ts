import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDb, FakeTerminal } from '@broker/money/testing';
import { USDT_TRC20_CONTRACT } from '@broker/money';
import { createTestDb, type TestDb } from '@broker/support/testing';
import { beginTwoFactorEnrollment, confirmTwoFactorEnrollment, generateTotp, twoFactorKey } from '@broker/support';

const KEY_RAW = 'test-key-'.repeat(6);

const env = vi.hoisted(() => ({
  pg: null as unknown as import('@broker/support/testing').TestDb,
  money: null as unknown as import('@broker/money/testing').FakeDb,
  term: null as unknown as import('@broker/money/testing').FakeTerminal,
  jar: new Map<string, string>(),
  sessions: [] as string[],
  user: null as { id: string } | null,
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/headers', () => ({
  headers: () => new Map<string, string>(),
  cookies: () => ({
    get: (k: string) => (env.jar.has(k) ? { value: env.jar.get(k) } : undefined),
    set: (k: string, v: string) => env.jar.set(k, v),
    delete: (k: string) => env.jar.delete(k),
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock('@/i18n/redirect', () => ({ localeHref: async (p: string, l: string) => `/${l}${p === '/' ? '' : p}` }));
vi.mock('./db', () => ({ getPool: () => env.pg }));
vi.mock('./money', () => ({ moneyPool: () => env.money, terminalMoney: () => env.term }));
vi.mock('./auth/session', () => ({
  createSession: async (userId: string) => {
    env.sessions.push(userId);
    return 'token';
  },
  getSessionUser: async () => env.user,
  destroyCurrentSession: async () => {},
  revokeSession: async () => {},
}));

const key = twoFactorKey(KEY_RAW);
let userId: string;
let secret: string;
let clock = Date.now();

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

async function expectRedirect(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const m = /^REDIRECT:(.*)$/.exec((e as Error).message);
    if (m) return m[1]!;
    throw e;
  }
  throw new Error('нет редиректа');
}

const nextCode = () => {
  clock += 30_000;
  vi.setSystemTime(clock);
  return generateTotp(secret, {}, clock);
};

beforeAll(async () => {
  env.pg = await createTestDb();
});
afterAll(async () => env.pg.close());

beforeEach(async () => {
  vi.stubEnv('CABINET_TOTP_KEY', KEY_RAW);
  vi.useFakeTimers({ toFake: ['Date'] });
  clock += 3_600_000;
  vi.setSystemTime(clock);
  env.jar.clear();
  env.sessions.length = 0;
  userId = crypto.randomUUID();
  await env.pg.query(`INSERT INTO users (id, email, password_hash, full_name, locale) VALUES ($1, $2, $3, 'Анна Клиентова', 'ru')`, [
    userId,
    `${userId.slice(0, 8)}@client.test`,
    await bcrypt.hash('secret-pass', 4),
  ]);
  env.user = { id: userId };
  env.money = new FakeDb();
  env.money.clients.set(userId, { kycState: 'verified' });
  env.term = new FakeTerminal();
  env.term.balances.set(userId, 10_000);
  const { __resetRateLimit } = await import('./rate-limit');
  __resetRateLimit();
});

async function enable() {
  const b = await beginTwoFactorEnrollment(env.pg, { userId, key });
  if (!b.ok) throw new Error(b.reason);
  secret = b.secret;
  const c = await confirmTwoFactorEnrollment(env.pg, { userId, code: generateTotp(secret, {}, clock), key });
  if (!c.ok) throw new Error(c.reason);
  return c.recoveryCodes;
}

const login = (extra: Record<string, string> = {}) =>
  fd({ email: `${userId.slice(0, 8)}@client.test`, password: 'secret-pass', uiLocale: 'ru', ...extra });

describe('вход без 2FA', () => {
  it('пароль → сразу сессия и редирект', async () => {
    const { loginAction } = await import('./actions');
    expect(await expectRedirect(loginAction({}, login()))).toBe('/ru');
    expect(env.sessions).toEqual([userId]);
  });
});

describe('вход с 2FA', () => {
  it('после пароля сессии нет — только тикет второго шага; верный код выдаёт сессию и ведёт на next', async () => {
    await enable();
    const { loginAction, loginTwoFactorAction } = await import('./actions');
    expect(await loginAction({}, login())).toEqual({ twoFactor: true });
    expect(env.sessions).toEqual([]);
    expect(env.jar.get('cabinet_2fa')).toBeTruthy();

    expect(await loginTwoFactorAction({}, fd({ code: '000000', uiLocale: 'ru' }))).toEqual({ twoFactor: true, error: 'twoFactorInvalid' });
    expect(env.sessions).toEqual([]);

    const next = '/api/sso/launch?account=demo';
    expect(await expectRedirect(loginTwoFactorAction({}, fd({ code: nextCode(), uiLocale: 'ru', next })))).toBe(next);
    expect(env.sessions).toEqual([userId]);
    expect(env.jar.has('cabinet_2fa')).toBe(false);
  });

  it('резервный код подходит на входе', async () => {
    const codes = await enable();
    const { loginAction, loginTwoFactorAction } = await import('./actions');
    await loginAction({}, login());
    expect(await expectRedirect(loginTwoFactorAction({}, fd({ code: codes[0]!, uiLocale: 'en' })))).toBe('/en');
    expect(env.sessions).toEqual([userId]);
  });

  it('без тикета второго шага сессию не получить', async () => {
    await enable();
    const { loginTwoFactorAction } = await import('./actions');
    expect(await loginTwoFactorAction({}, fd({ code: nextCode() }))).toEqual({ error: 'twoFactorExpired' });
    expect(env.sessions).toEqual([]);
  });

  it('лимит попыток: после 5 неверных — блокировка, верный код тоже не пускает', async () => {
    await enable();
    const { loginAction, loginTwoFactorAction } = await import('./actions');
    await loginAction({}, login());
    const errors: (string | undefined)[] = [];
    for (let i = 0; i < 5; i++) errors.push((await loginTwoFactorAction({}, fd({ code: '999999' }))).error);
    expect(errors).toEqual(['twoFactorInvalid', 'twoFactorInvalid', 'twoFactorInvalid', 'twoFactorInvalid', 'twoFactorLocked']);
    await loginAction({}, login());
    expect(await loginTwoFactorAction({}, fd({ code: nextCode() }))).toEqual({ twoFactor: true, error: 'twoFactorLocked' });
    expect(env.sessions).toEqual([]);
  });
});

describe('критичные действия при включённой 2FA', () => {
  it('вывод средств: без кода и с неверным кодом — отказ без записи; с верным — заявка принята', async () => {
    await enable();
    const { requestWithdrawalAction } = await import('./money-actions');
    const base = { address: USDT_TRC20_CONTRACT, amount: '25.50' };
    expect(await requestWithdrawalAction({}, fd(base))).toEqual({ error: 'twoFactorRequired' });
    expect(await requestWithdrawalAction({}, fd({ ...base, code: '000000' }))).toEqual({ error: 'twoFactorInvalid' });
    expect(env.money.withdrawals.size).toBe(0);
    expect(await requestWithdrawalAction({}, fd({ ...base, code: nextCode() }))).toEqual({ ok: true, pending: false });
    expect(env.term.balances.get(userId)).toBe(10_000 - 2550);
  });

  it('вывод без 2FA — код не нужен', async () => {
    const { requestWithdrawalAction } = await import('./money-actions');
    expect(await requestWithdrawalAction({}, fd({ address: USDT_TRC20_CONTRACT, amount: '10' }))).toEqual({ ok: true, pending: false });
  });

  it('смена пароля требует код', async () => {
    await enable();
    const { changePasswordAction } = await import('./actions');
    const f = { currentPassword: 'secret-pass', newPassword: 'new-pass-123', confirmPassword: 'new-pass-123' };
    expect(await changePasswordAction({}, fd(f))).toEqual({ fieldErrors: { code: 'twoFactorRequired' } });
    expect(await changePasswordAction({}, fd({ ...f, code: nextCode() }))).toEqual({ ok: true });
  });

  it('отключение 2FA требует код', async () => {
    await enable();
    const { disableTwoFactorAction } = await import('./two-factor-actions');
    expect(await disableTwoFactorAction({}, fd({ code: '' }))).toEqual({ error: 'twoFactorInvalid' });
    expect(await disableTwoFactorAction({}, fd({ code: nextCode() }))).toEqual({ ok: true, disabled: true });
  });
});
