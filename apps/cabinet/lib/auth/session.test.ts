import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows: Record<string, unknown>[] = [];

vi.mock('../db', () => ({
  getPool: () => ({
    query: async () => ({ rows }),
  }),
}));

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => ({ value: 'token-value' }) }),
  headers: () => new Map(),
}));

const ROW = {
  id: 'f1b9c2e0-0000-4000-8000-000000000001',
  uid: 100042,
  email: 'ivan@example.com',
  full_name: 'Иван Петров',
  locale: 'ru',
  vip_level: 0,
  created_at: new Date('2026-10-01T00:00:00Z'),
};

beforeEach(() => {
  rows.length = 0;
  vi.restoreAllMocks();
});

describe('getSessionUser · номер пользователя', () => {
  it('нормальная строка: номер приходит как есть', async () => {
    rows.push({ ...ROW });
    const { getSessionUser } = await import('./session');

    expect((await getSessionUser())?.uid).toBe(100042);
  });

  it('номера нет → `null`, а НЕ ноль', async () => {
    rows.push({ ...ROW, uid: null });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getSessionUser } = await import('./session');

    const user = await getSessionUser();

    expect(user?.uid).toBeNull();
    expect(user?.uid).not.toBe(0);
  });

  it('пропажа номера называется в логе, а не проглатывается', async () => {
    rows.push({ ...ROW, uid: null });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getSessionUser } = await import('./session');

    await getSessionUser();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toContain('uid');
  });

  it('остальные поля строки от этого не страдают', async () => {
    rows.push({ ...ROW, uid: null });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getSessionUser } = await import('./session');

    const user = await getSessionUser();

    expect(user?.email).toBe('ivan@example.com');
    expect(user?.fullName).toBe('Иван Петров');
  });

  it('`vipLevel` ноль — настоящее значение, а не подстановка', async () => {
    rows.push({ ...ROW, vip_level: 0 });
    const { getSessionUser } = await import('./session');

    expect((await getSessionUser())?.vipLevel).toBe(0);
  });
});

describe('getSessionUser · блокировка клиента (ADM-02)', () => {
  it('заблокированный клиент с живой сессией → null (зона (app) уводит на вход)', async () => {
    rows.push({ ...ROW, blocked: true });
    const { getSessionUser } = await import('./session');

    expect(await getSessionUser()).toBeNull();
  });

  it('разблокированный (blocked=false) → пользователь возвращается', async () => {
    rows.push({ ...ROW, blocked: false });
    const { getSessionUser } = await import('./session');

    expect((await getSessionUser())?.id).toBe(ROW.id);
  });
});
