import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({
  getPool: () => {
    throw new Error('пул не должен трогаться — тест подаёт фейк');
  },
}));

import { listClientRegistry } from './registry';
import { hasRegistryFilter, parseRegistryQuery, registryHref } from './registry-params';

/**
 * Реестр клиентов (фаза 2): параметры из URL приводятся к закрытому множеству,
 * пользовательский текст попадает в SQL только параметром, сортировка — из
 * whitelist, пагинация — LIMIT/OFFSET по 50.
 */

describe('реестр клиентов · параметры URL', () => {
  it('по умолчанию: без фильтров, регистрация по убыванию, стр. 1', () => {
    const q = parseRegistryQuery({});
    expect(q).toEqual({ q: '', kyc: 'all', aml: 'all', access: 'all', sort: 'registered', dir: 'desc', page: 1 });
    expect(hasRegistryFilter(q)).toBe(false);
    expect(registryHref(q)).toBe('/clients');
  });

  it('неизвестные значения → умолчания, а не ошибка', () => {
    const q = parseRegistryQuery({ kyc: 'hacked', aml: "x'; DROP", access: '?', sort: 'password', dir: 'up', page: '-3' });
    expect(q).toMatchObject({ kyc: 'all', aml: 'all', access: 'all', sort: 'registered', dir: 'desc', page: 1 });
  });

  it('старые ссылки `?sort=name_asc` и `?state=` продолжают работать', () => {
    const q = parseRegistryQuery({ sort: 'name_asc', state: 'pending' });
    expect(q).toMatchObject({ sort: 'name', dir: 'asc', kyc: 'pending' });
  });

  it('href сохраняет фильтры и сортировку, страницу 1 не пишет', () => {
    const q = parseRegistryQuery({ q: 'Иван', kyc: 'verified', aml: 'escalated', access: 'blocked', sort: 'balance', dir: 'asc', page: '2' });
    expect(hasRegistryFilter(q)).toBe(true);
    const href = registryHref(q, { page: 1 });
    const sp = new URLSearchParams(href.split('?')[1]);
    expect(Object.fromEntries(sp)).toEqual({ q: 'Иван', kyc: 'verified', aml: 'escalated', access: 'blocked', sort: 'balance', dir: 'asc' });
  });
});

describe('реестр клиентов · SQL', () => {
  function fakeDb() {
    const calls: { sql: string; params: unknown[] }[] = [];
    return {
      calls,
      async query(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        if (/count\(\*\)/.test(sql)) return { rows: [{ n: 51 }] };
        return {
          rows: [
            {
              id: 'u1',
              full_name: 'Тест',
              email: 't@example.com',
              created_at: '2026-11-01T00:00:00Z',
              last_login_at: null,
              kyc: 'verified',
              aml: 'escalated',
              blocked: true,
              frozen: false,
              withdraw_banned: true,
              balance_cents: '123456',
              currency: 'USDT',
            },
          ],
        };
      },
    };
  }

  it('поиск — параметром, сортировка — из whitelist, вторая страница — OFFSET 50', async () => {
    const db = fakeDb();
    const page = await listClientRegistry(
      parseRegistryQuery({ q: "o'neil", aml: 'escalated', access: 'restricted', sort: 'balance', dir: 'asc', page: '2' }),
      db,
    );
    const select = db.calls.find((c) => /ORDER BY/.test(c.sql))!;
    expect(select.sql).not.toContain("o'neil");
    expect(select.params).toEqual(["%o'neil%", 'escalated']);
    expect(select.sql).toMatch(/ORDER BY ra\.balance_cents ASC NULLS LAST/);
    expect(select.sql).toMatch(/LIMIT 50 OFFSET 50/);
    expect(select.sql).toMatch(/mf\.frozen/);
    expect(page.total).toBe(51);
    expect(page.rows[0]).toMatchObject({ aml: 'escalated', blocked: true, withdrawBanned: true, balanceMinor: 123456 });
  });
});
