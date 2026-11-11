import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADM-02 · блокировка действует на ВХОДЕ.
 *
 * До этой задачи кабинет не читал `client_blocks` вовсе: блок в админке был
 * записью в журнале, а клиент продолжал входить. Проверяем связку «строка
 * блокировки → отказ входа», порядок проверок (о блоке — только после верного
 * пароля) и что разблокировка возвращает доступ.
 */

const state = { row: null as Record<string, unknown> | null, sql: '' };

vi.mock('../db', () => ({
  getPool: () => ({
    query: async (sql: string) => {
      state.sql = sql;
      return { rows: state.row ? [state.row] : [] };
    },
  }),
}));

vi.mock('./password', () => ({
  verifyPassword: async (password: string, hash: string) => hash === `hash:${password}`,
}));

const ROW = { id: 'user-1', password_hash: 'hash:secret-pass', locale: 'ru' };

beforeEach(() => {
  state.row = null;
  state.sql = '';
});

describe('checkLogin · блокировка клиента', () => {
  it('не заблокирован, верный пароль → вход есть', async () => {
    state.row = { ...ROW, blocked: false };
    const { checkLogin } = await import('./login');
    await expect(checkLogin('a@b.c', 'secret-pass')).resolves.toEqual({
      ok: true,
      userId: 'user-1',
      locale: 'ru',
      mustChangePassword: false,
    });
  });

  it('временный пароль от менеджера: вход есть, но с обязательной сменой; истёк — отказ', async () => {
    state.row = { ...ROW, blocked: false, password_must_change: true, temp_expired: false };
    const { checkLogin } = await import('./login');
    await expect(checkLogin('a@b.c', 'secret-pass')).resolves.toMatchObject({ ok: true, mustChangePassword: true });
    state.row = { ...ROW, blocked: false, password_must_change: true, temp_expired: true };
    await expect(checkLogin('a@b.c', 'secret-pass')).resolves.toEqual({ ok: false, error: 'tempPasswordExpired' });
    // Неверный пароль при истёкшем временном — не оракул: invalidCredentials.
    await expect(checkLogin('a@b.c', 'wrong')).resolves.toEqual({ ok: false, error: 'invalidCredentials' });
  });

  it('заблокирован, верный пароль → accessRestricted, сессии не будет', async () => {
    state.row = { ...ROW, blocked: true };
    const { checkLogin } = await import('./login');
    await expect(checkLogin('a@b.c', 'secret-pass')).resolves.toEqual({
      ok: false,
      error: 'accessRestricted',
    });
  });

  it('заблокирован, НЕверный пароль → invalidCredentials (форма не оракул блокировки)', async () => {
    state.row = { ...ROW, blocked: true };
    const { checkLogin } = await import('./login');
    await expect(checkLogin('a@b.c', 'wrong')).resolves.toEqual({
      ok: false,
      error: 'invalidCredentials',
    });
  });

  it('разблокирован (строка есть, blocked=false) → вход возвращается', async () => {
    state.row = { ...ROW, blocked: false };
    const { checkLogin } = await import('./login');
    await expect(checkLogin('a@b.c', 'secret-pass')).resolves.toMatchObject({ ok: true });
  });

  it('нет такого email → invalidCredentials', async () => {
    const { checkLogin } = await import('./login');
    await expect(checkLogin('none@b.c', 'x')).resolves.toEqual({
      ok: false,
      error: 'invalidCredentials',
    });
  });

  it('запрос действительно читает client_blocks', async () => {
    state.row = { ...ROW, blocked: false };
    const { checkLogin } = await import('./login');
    await checkLogin('a@b.c', 'secret-pass');
    expect(state.sql).toMatch(/client_blocks/);
  });
});
