import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADM-01 · вход оператора: успех / провал / отключённый (Р-451).
 *
 * База замокана; argon2id настоящий (дешёвые параметры). Проверяется:
 *  - верный логин+пароль живого оператора → сессия;
 *  - неверный пароль, несуществующий логин, NULL-хеш → общий отказ `{ok:false}`
 *    (форма не оракул: по ответу не узнать, что именно не так);
 *  - отключённый оператор (`disabled_at`) с верным паролем → отказ;
 *  - прозрачный перехеш: отставшие параметры хеша → UPDATE при успехе.
 */

const calls: { sql: string; params: unknown[] }[] = [];
let operatorRow: Record<string, unknown> | undefined;

vi.mock('../db', () => ({
  getPool: () => ({
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/FROM operators WHERE login/i.test(sql)) {
        return { rows: operatorRow ? [operatorRow] : [] };
      }
      return { rows: [] };
    },
  }),
}));

function setCheapParams() {
  process.env.ADMIN_ARGON_MEMORY_KIB = '1024';
  process.env.ADMIN_ARGON_TIME = '1';
  process.env.ADMIN_ARGON_PARALLELISM = '1';
}

const ID = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  calls.length = 0;
  operatorRow = undefined;
  setCheapParams();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.ADMIN_ARGON_MEMORY_KIB;
  delete process.env.ADMIN_ARGON_TIME;
  delete process.env.ADMIN_ARGON_PARALLELISM;
  vi.restoreAllMocks();
});

async function makeRow(password: string, over: Record<string, unknown> = {}) {
  const { hashPassword } = await import('./password');
  return {
    id: ID,
    login: 'super',
    display_name: 'Главный оператор',
    role: 'admin',
    password_hash: await hashPassword(password),
    disabled_at: null,
    ...over,
  };
}

describe('вход оператора', () => {
  it('верный логин+пароль живого оператора → сессия', async () => {
    operatorRow = await makeRow('correct horse');
    const { verifyOperatorCredentials } = await import('./login');

    const result = await verifyOperatorCredentials('super', 'correct horse');
    expect(result).toEqual({
      ok: true,
      session: { operatorId: ID, login: 'super', displayName: 'Главный оператор', role: 'admin' },
    });
  });

  it('неверный пароль → отказ без деталей', async () => {
    operatorRow = await makeRow('correct horse');
    const { verifyOperatorCredentials } = await import('./login');

    expect(await verifyOperatorCredentials('super', 'wrong')).toEqual({ ok: false });
  });

  it('несуществующий логин → тот же общий отказ', async () => {
    operatorRow = undefined;
    const { verifyOperatorCredentials } = await import('./login');

    expect(await verifyOperatorCredentials('ghost', 'whatever')).toEqual({ ok: false });
  });

  it('NULL password_hash (входа нет, fail-closed) → отказ даже при пустом пароле', async () => {
    operatorRow = await makeRow('x', { password_hash: null });
    const { verifyOperatorCredentials } = await import('./login');

    expect(await verifyOperatorCredentials('super', 'x')).toEqual({ ok: false });
    expect(await verifyOperatorCredentials('super', '')).toEqual({ ok: false });
  });

  it('отключённый оператор с ВЕРНЫМ паролем → отказ', async () => {
    operatorRow = await makeRow('correct horse', { disabled_at: new Date('2026-01-01') });
    const { verifyOperatorCredentials } = await import('./login');

    expect(await verifyOperatorCredentials('super', 'correct horse')).toEqual({ ok: false });
  });

  it('неизвестная роль → отказ (не «наверное оператор»)', async () => {
    operatorRow = await makeRow('correct horse', { role: 'wizard' });
    const { verifyOperatorCredentials } = await import('./login');

    expect(await verifyOperatorCredentials('super', 'correct horse')).toEqual({ ok: false });
  });
});

describe('вход · прозрачный перехеш (Р-451)', () => {
  it('параметры хеша отстали → при успехе идёт UPDATE password_hash', async () => {
    // Храним хеш на m=1024, затем ужесточаем конфиг — хеш отстал.
    operatorRow = await makeRow('correct horse');
    process.env.ADMIN_ARGON_MEMORY_KIB = '2048';
    const { verifyOperatorCredentials } = await import('./login');

    const result = await verifyOperatorCredentials('super', 'correct horse');
    expect(result.ok).toBe(true);
    const update = calls.find((c) => /UPDATE operators SET password_hash/i.test(c.sql));
    expect(update, 'перехеш должен обновить password_hash').toBeTruthy();
    // Новый хеш — на усиленных параметрах.
    expect(String(update!.params[0])).toMatch(/m=2048,t=1,p=1/);
  });

  it('параметры совпадают → UPDATE не идёт', async () => {
    operatorRow = await makeRow('correct horse');
    const { verifyOperatorCredentials } = await import('./login');

    await verifyOperatorCredentials('super', 'correct horse');
    expect(calls.some((c) => /UPDATE operators SET password_hash/i.test(c.sql))).toBe(false);
  });
});
