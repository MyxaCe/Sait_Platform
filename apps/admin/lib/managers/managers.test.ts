import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({
  getPool: () => {
    throw new Error('пул не должен трогаться — тест подаёт фейк');
  },
}));

import { ALL_ROLES } from '@/components/shell/sections';
import { assignClientManagers, setClientManagerFlag } from './assign';
import {
  BULK_ASSIGN_LIMIT,
  canAssignManagers,
  managerFilterValue,
  parseManagerFilter,
  roleCanManageClients,
} from './policy';
import { MANAGER_ROLES_SQL } from './queries';

const ADMIN = '00000000-0000-4000-8000-00000000a001';
const MGR = '00000000-0000-4000-8000-00000000b001';
const MGR2 = '00000000-0000-4000-8000-00000000b002';
const U1 = '00000000-0000-4000-8000-0000000c0001';
const U2 = '00000000-0000-4000-8000-0000000c0002';

/**
 * Фейковая транзакция: отвечает на запросы ядра по их SQL. Журнал имитируется
 * на уровне SQL `appendJournalWithinTx` (advisory lock / select last / insert).
 */
function fakePool(state: {
  managers: Record<string, { display_name: string; role: string; is_client_manager: boolean; disabled_at: string | null; login?: string }>;
  users: string[];
  assigned: Record<string, string>;
}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const journal: { action: string; subject: string; payload: Record<string, unknown> }[] = [];
  let seq = 0;
  const client = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      const s = sql.replace(/\s+/g, ' ');
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(s.trim())) return { rows: [] };
      if (s.includes('FROM operators WHERE id = $1') && s.includes('is_client_manager, disabled_at FROM')) {
        const m = state.managers[params[0] as string];
        return { rows: m ? [{ id: params[0], ...m }] : [] };
      }
      if (s.includes('SELECT role, is_client_manager, disabled_at, login FROM operators')) {
        const m = state.managers[params[0] as string];
        return { rows: m ? [{ login: 'x', ...m }] : [] };
      }
      if (s.includes('SELECT id FROM users WHERE id = ANY')) {
        return { rows: (params[0] as string[]).filter((u) => state.users.includes(u)).map((id) => ({ id })) };
      }
      if (s.includes('FROM client_managers cm JOIN operators o')) {
        return {
          rows: (params[0] as string[])
            .filter((u) => state.assigned[u])
            .map((u) => ({ user_id: u, manager_id: state.assigned[u], display_name: state.managers[state.assigned[u]!]?.display_name })),
        };
      }
      if (s.startsWith('INSERT INTO client_managers')) {
        state.assigned[params[0] as string] = params[1] as string;
        return { rows: [] };
      }
      if (s.startsWith('DELETE FROM client_managers')) {
        delete state.assigned[params[0] as string];
        return { rows: [] };
      }
      if (s.includes('count(*)::int AS n FROM client_managers')) {
        return { rows: [{ n: Object.values(state.assigned).filter((m) => m === params[0]).length }] };
      }
      if (s.startsWith('UPDATE operators SET is_client_manager')) {
        state.managers[params[0] as string]!.is_client_manager = params[1] as boolean;
        return { rows: [] };
      }
      // Журнал (@broker/money appendJournalWithinTx)
      if (s.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (s.includes('FROM admin_action_journal') && s.includes('ORDER BY seq DESC')) return { rows: [] };
      if (s.startsWith('INSERT INTO admin_action_journal')) {
        seq += 1;
        // (occurred_at, operator_id, action, subject_kind, subject_id, payload, prev_hash, entry_hash)
        journal.push({
          action: String(params[2]),
          subject: String(params[4]),
          payload: JSON.parse(String(params[5])) as Record<string, unknown>,
        });
        return { rows: [] };
      }
      if (s.includes('SELECT seq FROM admin_action_journal WHERE entry_hash')) return { rows: [{ seq }] };
      if (s.startsWith('UPDATE client_managers SET last_journal_seq')) return { rows: [] };
      return { rows: [] };
    },
    release() {},
  };
  return { pool: { connect: async () => client as never }, calls, journal, state };
}

const baseState = () => ({
  managers: {
    [MGR]: { display_name: 'Анна Менеджер', role: 'operator', is_client_manager: true, disabled_at: null },
    [MGR2]: { display_name: 'Борис Финансы', role: 'finance_operator', is_client_manager: true, disabled_at: null },
  } as Record<string, { display_name: string; role: string; is_client_manager: boolean; disabled_at: string | null }>,
  users: [U1, U2],
  assigned: {} as Record<string, string>,
});

describe('менеджеры · политика', () => {
  it('менеджером может быть только роль, видящая «Клиентов»; назначает только admin', () => {
    const can = ALL_ROLES.filter((r) => roleCanManageClients(r));
    expect(can).toEqual(['admin', 'operator', 'finance_operator']);
    expect(MANAGER_ROLES_SQL).toBe(`(${can.map((r) => `'${r}'`).join(',')})`);
    expect(ALL_ROLES.filter((r) => canAssignManagers(r))).toEqual(['admin']);
    expect(canAssignManagers(null)).toBe(false);
  });

  it('фильтр ?mgr= — закрытое множество; мусор → умолчание зрителя', () => {
    expect(parseManagerFilter('', 'mine')).toBe('mine');
    expect(parseManagerFilter('', 'all')).toBe('all');
    expect(parseManagerFilter('none', 'mine')).toBe('none');
    expect(parseManagerFilter("x' OR 1=1", 'all')).toBe('all');
    expect(parseManagerFilter(MGR.toUpperCase(), 'all')).toEqual({ managerId: MGR });
    expect(managerFilterValue({ managerId: MGR })).toBe(MGR);
  });
});

describe('менеджеры · назначение (транзакционное ядро)', () => {
  it('без основания — отказ без транзакции', async () => {
    const f = fakePool(baseState());
    const r = await assignClientManagers({ actorId: ADMIN, userIds: [U1], managerId: MGR, reason: '  ' }, f.pool);
    expect(r).toEqual({ ok: false, reason: 'missingReason' });
    expect(f.calls).toHaveLength(0);
  });

  it('пачка больше потолка и мусорный id — отказ', async () => {
    const f = fakePool(baseState());
    const many = Array.from({ length: BULK_ASSIGN_LIMIT + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(await assignClientManagers({ actorId: ADMIN, userIds: many, managerId: MGR, reason: 'r' }, f.pool)).toEqual({ ok: false, reason: 'tooMany' });
    expect(await assignClientManagers({ actorId: ADMIN, userIds: ['1; DROP'], managerId: MGR, reason: 'r' }, f.pool)).toEqual({ ok: false, reason: 'invalidClient' });
  });

  it('менеджер без флага / отключённый / support_operator — непригоден, ничего не пишется', async () => {
    for (const m of [
      { display_name: 'x', role: 'operator', is_client_manager: false, disabled_at: null },
      { display_name: 'x', role: 'operator', is_client_manager: true, disabled_at: '2026-11-01' },
      { display_name: 'x', role: 'support_operator', is_client_manager: true, disabled_at: null },
    ]) {
      const st = baseState();
      st.managers[MGR] = m;
      const f = fakePool(st);
      const r = await assignClientManagers({ actorId: ADMIN, userIds: [U1], managerId: MGR, reason: 'r' }, f.pool);
      expect(r).toEqual({ ok: false, reason: 'managerNotEligible' });
      expect(f.journal).toHaveLength(0);
      expect(f.calls.some((c) => /ROLLBACK/.test(c.sql))).toBe(true);
    }
  });

  it('несуществующий клиент в пачке — откат всей пачки', async () => {
    const f = fakePool(baseState());
    const r = await assignClientManagers(
      { actorId: ADMIN, userIds: [U1, '00000000-0000-4000-8000-0000000c0999'], managerId: MGR, reason: 'r' },
      f.pool,
    );
    expect(r).toEqual({ ok: false, reason: 'noClient' });
    expect(f.state.assigned).toEqual({});
  });

  it('массовое назначение: запись журнала на каждого клиента с прежним менеджером и bulk', async () => {
    const st = baseState();
    st.assigned[U2] = MGR2;
    const f = fakePool(st);
    const r = await assignClientManagers({ actorId: ADMIN, userIds: [U1, U2], managerId: MGR, reason: 'передача портфеля' }, f.pool);
    expect(r).toEqual({ ok: true, changed: 2, unchanged: 0 });
    expect(f.state.assigned).toEqual({ [U1]: MGR, [U2]: MGR });
    expect(f.journal.map((j) => j.action)).toEqual(['client.manager_assigned', 'client.manager_assigned']);
    const second = f.journal[1]!.payload;
    expect(second).toMatchObject({
      basis: 'передача портфеля',
      managerId: MGR,
      managerName: 'Анна Менеджер',
      previousManagerId: MGR2,
      previousManagerName: 'Борис Финансы',
      bulk: true,
      batchSize: 2,
    });
    expect(f.calls.some((c) => /COMMIT/.test(c.sql))).toBe(true);
  });

  it('тот же менеджер — без записи в журнал (нет содержательного перехода)', async () => {
    const st = baseState();
    st.assigned[U1] = MGR;
    const f = fakePool(st);
    const r = await assignClientManagers({ actorId: ADMIN, userIds: [U1], managerId: MGR, reason: 'r' }, f.pool);
    expect(r).toEqual({ ok: true, changed: 0, unchanged: 1 });
    expect(f.journal).toHaveLength(0);
  });

  it('снятие менеджера — client.manager_unassigned, строка удалена', async () => {
    const st = baseState();
    st.assigned[U1] = MGR;
    const f = fakePool(st);
    const r = await assignClientManagers({ actorId: ADMIN, userIds: [U1], managerId: null, reason: 'уволился' }, f.pool);
    expect(r).toEqual({ ok: true, changed: 1, unchanged: 0 });
    expect(f.state.assigned).toEqual({});
    expect(f.journal[0]).toMatchObject({ action: 'client.manager_unassigned', payload: { previousManagerId: MGR, managerId: null } });
    expect(f.journal[0]!.payload.bulk).toBeUndefined();
  });
});

describe('менеджеры · флаг у оператора', () => {
  it('нельзя снять флаг, пока за оператором есть клиенты', async () => {
    const st = baseState();
    st.assigned[U1] = MGR;
    const f = fakePool(st);
    const r = await setClientManagerFlag({ actorId: ADMIN, operatorId: MGR, enabled: false, reason: 'r' }, f.pool);
    expect(r).toEqual({ ok: false, reason: 'hasClients' });
    expect(f.journal).toHaveLength(0);
  });

  it('support_operator не может стать менеджером', async () => {
    const st = baseState();
    st.managers[MGR] = { display_name: 'S', role: 'support_operator', is_client_manager: false, disabled_at: null };
    const f = fakePool(st);
    expect(await setClientManagerFlag({ actorId: ADMIN, operatorId: MGR, enabled: true, reason: 'r' }, f.pool)).toEqual({
      ok: false,
      reason: 'roleNotEligible',
    });
  });

  it('выдача флага — запись operator.client_manager_granted', async () => {
    const st = baseState();
    st.managers[MGR]!.is_client_manager = false;
    const f = fakePool(st);
    expect(await setClientManagerFlag({ actorId: ADMIN, operatorId: MGR, enabled: true, reason: 'новый менеджер' }, f.pool)).toEqual({ ok: true });
    expect(st.managers[MGR]!.is_client_manager).toBe(true);
    expect(f.journal[0]).toMatchObject({ action: 'operator.client_manager_granted', payload: { basis: 'новый менеджер' } });
  });
});
