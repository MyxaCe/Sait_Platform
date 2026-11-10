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
    expect(q).toEqual({ q: '', kyc: 'all', aml: 'all', access: 'all', sort: 'registered', dir: 'desc', page: 1, mgr: 'all', mgrDefault: 'all' });
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

describe('реестр клиентов · менеджер (ветка admin-managers)', () => {
  const MGR = '00000000-0000-4000-8000-00000000b001';

  it('менеджеру по умолчанию — «Мои клиенты», и это не считается фильтром', () => {
    const q = parseRegistryQuery({}, { defaultMine: true });
    expect(q.mgr).toBe('mine');
    expect(hasRegistryFilter(q)).toBe(false);
    expect(registryHref(q)).toBe('/clients');
    // Явное «все» у менеджера — уже отличие от умолчания, пишется в URL.
    const all = parseRegistryQuery({ mgr: 'all' }, { defaultMine: true });
    expect(hasRegistryFilter(all)).toBe(true);
    expect(registryHref(all)).toBe('/clients?mgr=all');
  });

  it('не-менеджеру `mgr=mine` пишется явно; id менеджера переживает href', () => {
    expect(registryHref(parseRegistryQuery({ mgr: 'mine' }))).toBe('/clients?mgr=mine');
    expect(registryHref(parseRegistryQuery({ mgr: MGR, page: '2' }))).toBe(`/clients?mgr=${MGR}&page=2`);
    expect(parseRegistryQuery({ mgr: 'bogus' }).mgr).toBe('all');
  });

  function db() {
    const calls: { sql: string; params: unknown[] }[] = [];
    return {
      calls,
      async query(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        if (/count\(\*\)/.test(sql)) return { rows: [{ n: 0 }] };
        return { rows: [] };
      },
    };
  }

  it('«мои» — по id зрителя параметром; без зрителя — пусто (fail-closed)', async () => {
    const d = db();
    await listClientRegistry(parseRegistryQuery({}, { defaultMine: true }), d as never, MGR);
    expect(d.calls[1]!.sql).toMatch(/cm\.manager_id = \$1/);
    expect(d.calls[1]!.params).toEqual([MGR]);

    const n = db();
    await listClientRegistry(parseRegistryQuery({ mgr: 'mine' }), n as never, null);
    expect(n.calls[1]!.sql).toMatch(/WHERE false/);
  });

  it('«без менеджера» и конкретный менеджер', async () => {
    const a = db();
    await listClientRegistry(parseRegistryQuery({ mgr: 'none' }), a as never, MGR);
    expect(a.calls[1]!.sql).toMatch(/cm\.manager_id IS NULL/);
    const b = db();
    await listClientRegistry(parseRegistryQuery({ mgr: MGR }), b as never, null);
    expect(b.calls[1]!.params).toEqual([MGR]);
  });
});
