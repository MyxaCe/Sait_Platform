import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '@broker/support/testing';
import { decodePendingActivation, PENDING_ACTIVATION_COOKIE } from './auth/pending-activation';

// Регистрация только с подтверждённой почтой (решение владельца 26.11): сквозной путь
// через настоящие server actions кабинета и схему базы из миграций.

const env = vi.hoisted(() => ({
  pg: null as unknown as import('@broker/support/testing').TestDb,
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
// Лимит по IP в памяти процесса проверяется отдельно; здесь все регистрации с одного «IP».
vi.mock('./rate-limit', () => ({ isRateLimited: () => false }));
vi.mock('./support/state', () => ({ supportPool: () => env.pg }));
vi.mock('./support/auth-link', () => ({
  authLinkBuilder: async () => (p: string, token: string, locale: string) => `https://cabinet.test/${locale}${p}?token=${token}`,
}));
vi.mock('./tenant', () => ({ getTenantStartBalance: async () => ({ state: 'set', cents: 1_000_000 }) }));
vi.mock('./legal-consent', () => ({
  loadConsentDocuments: async () => null,
  decodeShownVersions: () => new Map(),
  consentRecords: () => [],
}));
vi.mock('./auth/session', () => ({
  createSession: async (userId: string) => {
    env.sessions.push(userId);
    return 'token';
  },
  getSessionUser: async () => env.user,
  destroyCurrentSession: async () => {},
  revokeSession: async () => {},
  hashToken: (t: string) => t,
}));

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

let n = 0;
let email = '';
const form = (extra: Record<string, string> = {}) =>
  fd({
    firstName: 'Анна',
    lastName: 'Клиентова',
    email,
    phone: '+35725000001',
    country: 'CY',
    password: 'secret1234!',
    locale: 'ru',
    consent: 'on',
    ...extra,
  });

async function verifyTokens(): Promise<string[]> {
  const r = await env.pg.query(
    `SELECT body_text FROM outbound_mail WHERE purpose = 'email_verify' AND to_address = $1 ORDER BY created_at`,
    [email],
  );
  return r.rows.map((x) => /token=([A-Za-z0-9_-]+)/.exec(String(x.body_text))![1]!);
}

beforeAll(async () => {
  env.pg = await createTestDb();
});
afterAll(async () => env.pg.close());

beforeEach(() => {
  env.jar.clear();
  env.sessions.length = 0;
  env.user = null;
  n += 1;
  email = `anna${n}@client.test`;
});

describe('регистрация → нет входа → ссылка из письма → кабинет', () => {
  it('после формы сессии нет: экран «Проверьте почту», письмо со ссылкой, cookie ожидания', async () => {
    const { registerAction } = await import('./actions');
    expect(await expectRedirect(registerAction({}, form({ next: '/terminal?symbol=EURUSD' })))).toBe('/ru/register/check-email');
    expect(env.sessions).toEqual([]);
    const u = await env.pg.query(`SELECT activated_at, email_verified_at FROM users WHERE email = $1`, [email]);
    expect(u.rows[0]).toEqual({ activated_at: null, email_verified_at: null });
    expect(await verifyTokens()).toHaveLength(1);
    expect(decodePendingActivation(env.jar.get(PENDING_ACTIVATION_COOKIE))).toEqual({ email, next: '/terminal?symbol=EURUSD' });
  });

  it('вход до подтверждения: пароль верный, но сессии нет — emailNotVerified', async () => {
    const { registerAction, loginAction } = await import('./actions');
    await expectRedirect(registerAction({}, form()));
    env.jar.clear();
    expect(await loginAction({}, fd({ email, password: 'secret1234!', uiLocale: 'ru' }))).toEqual({ error: 'emailNotVerified' });
    expect(env.sessions).toEqual([]);
    expect(decodePendingActivation(env.jar.get(PENDING_ACTIVATION_COOKIE))?.email).toBe(email);
    expect(await loginAction({}, fd({ email, password: 'wrong-pass', uiLocale: 'ru' }))).toEqual({ error: 'invalidCredentials' });
  });

  it('ссылка впускает в кабинет и ведёт туда, куда клиент шёл; двойной клик не ломается', async () => {
    const { registerAction } = await import('./actions');
    const { confirmEmailAction } = await import('./support/auth-actions');
    await expectRedirect(registerAction({}, form({ next: '/terminal?symbol=EURUSD' })));
    const [token] = await verifyTokens();
    expect(await expectRedirect(confirmEmailAction({}, fd({ token: token!, uiLocale: 'ru' })))).toBe('/terminal?symbol=EURUSD');
    const id = String((await env.pg.query(`SELECT id FROM users WHERE email = $1`, [email])).rows[0]!.id);
    expect(env.sessions).toEqual([id]);
    expect(env.jar.has(PENDING_ACTIVATION_COOKIE)).toBe(false);

    env.user = { id };
    expect(await expectRedirect(confirmEmailAction({}, fd({ token: token!, uiLocale: 'ru' })))).toBe('/ru');
    env.user = null;
    expect(await confirmEmailAction({}, fd({ token: token!, uiLocale: 'ru' }))).toEqual({ error: 'usedToken' });
    expect(env.sessions).toEqual([id]);

    const { loginAction } = await import('./actions');
    expect(await expectRedirect(loginAction({}, fd({ email, password: 'secret1234!', uiLocale: 'ru' })))).toBe('/ru');
  });

  it('повторная регистрация того же адреса: тот же экран, без ошибки «уже существует»', async () => {
    const { registerAction } = await import('./actions');
    await expectRedirect(registerAction({}, form()));
    env.jar.clear();
    expect(await expectRedirect(registerAction({}, form()))).toBe('/ru/register/check-email');
    expect((await env.pg.query(`SELECT count(*)::int AS c FROM users WHERE email = $1`, [email])).rows[0]!.c).toBe(1);
  });

  it('«Отправить ещё раз»: сразу — tooSoon (письмо только что ушло); без cookie — noPending', async () => {
    const { registerAction } = await import('./actions');
    const { resendActivationAction } = await import('./support/auth-actions');
    await expectRedirect(registerAction({}, form()));
    expect(await resendActivationAction({}, fd({}))).toEqual({ error: 'tooSoon' });
    env.jar.clear();
    expect(await resendActivationAction({}, fd({}))).toEqual({ error: 'noPending' });
  });
});
