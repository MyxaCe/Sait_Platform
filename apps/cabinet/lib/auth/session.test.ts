import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * QA-05 · публичный номер пользователя не выдумывается (Р-086).
 *
 * `uid` — это то, что человек видит в кабинете и **называет поддержке**
 * (так и записано в комментарии миграции 003). Ноль здесь не читается как
 * «неизвестно»: настоящие номера начинаются со 100001, и «UID 0» выглядит
 * как настоящий номер — человек процитирует его как факт, отправив и себя,
 * и поддержку искать несуществующий счёт.
 *
 * **Грабля, ради которой тест и написан:** `Number(null)` это **0**. Одного
 * удаления `?? 0` было бы мало — приведение подставляет ноль само.
 * Проверка обязана стоять ДО приведения, и именно это здесь закреплено.
 */

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
    // Главное утверждение задачи.
    rows.push({ ...ROW, uid: null });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getSessionUser } = await import('./session');

    const user = await getSessionUser();

    expect(user?.uid).toBeNull();
    expect(user?.uid).not.toBe(0);
  });

  it('пропажа номера называется в логе, а не проглатывается', async () => {
    // Прочерк на экране честен, но аномалию строки он прячет: колонка
    // `NOT NULL`, значит пустое значение — сломанные данные, и кто-то
    // должен об этом узнать.
    rows.push({ ...ROW, uid: null });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getSessionUser } = await import('./session');

    await getSessionUser();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toContain('uid');
  });

  it('остальные поля строки от этого не страдают', async () => {
    // Растяжка: отказ от номера не должен превращаться в отказ от сессии.
    // Человек остаётся залогиненным, просто без показанного номера.
    rows.push({ ...ROW, uid: null });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { getSessionUser } = await import('./session');

    const user = await getSessionUser();

    expect(user?.email).toBe('ivan@example.com');
    expect(user?.fullName).toBe('Иван Петров');
  });

  it('`vipLevel` ноль — настоящее значение, а не подстановка', async () => {
    // Граница, которую легко стереть «за единообразие»: колонка
    // `INT NOT NULL DEFAULT 0`, и ноль означает «уровня нет». Прочерк был
    // бы здесь неправдой наоборот.
    rows.push({ ...ROW, vip_level: 0 });
    const { getSessionUser } = await import('./session');

    expect((await getSessionUser())?.vipLevel).toBe(0);
  });
});
