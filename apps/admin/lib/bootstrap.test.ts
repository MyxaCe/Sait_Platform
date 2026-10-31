import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapFirstOperator } from './bootstrap';

/**
 * ADM-01 · сид первого суперадмина одноразовый (Р-451).
 *
 * База замокана клиентом-эмулятором; argon2id настоящий (дешёвые параметры).
 * Главное утверждение: ПОВТОРНЫЙ запуск при непустой таблице операторов
 * отказывает и НИЧЕГО не вставляет — сид не бэкдор. И: первый запуск создаёт
 * оператора role=admin и пишет в журнал `operator.bootstrap`.
 */

interface FakeState {
  operatorsEmpty: boolean;
  calls: { sql: string; params: unknown[] }[];
}

function fakePool(state: FakeState) {
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      state.calls.push({ sql, params });
      if (/SELECT 1 FROM operators/i.test(sql)) {
        return { rows: state.operatorsEmpty ? [] : [{ '?column?': 1 }] };
      }
      if (/INSERT INTO operators/i.test(sql)) {
        return { rows: [{ id: '33333333-3333-3333-3333-333333333333' }] };
      }
      if (/SELECT entry_hash/i.test(sql)) {
        return { rows: [] };
      }
      return { rows: [] };
    },
    release: () => {},
  };
  return { connect: async () => client as never };
}

function setCheapParams() {
  process.env.ADMIN_ARGON_MEMORY_KIB = '1024';
  process.env.ADMIN_ARGON_TIME = '1';
  process.env.ADMIN_ARGON_PARALLELISM = '1';
}

beforeEach(() => {
  setCheapParams();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.ADMIN_ARGON_MEMORY_KIB;
  delete process.env.ADMIN_ARGON_TIME;
  delete process.env.ADMIN_ARGON_PARALLELISM;
  vi.restoreAllMocks();
});

const INPUT = { login: 'super', displayName: 'Главный оператор', password: 'correct horse battery' };

describe('сид · первый запуск', () => {
  it('создаёт оператора role=admin и пишет в журнал operator.bootstrap', async () => {
    const state: FakeState = { operatorsEmpty: true, calls: [] };

    const result = await bootstrapFirstOperator(INPUT, fakePool(state));
    expect(result).toEqual({ ok: true, operatorId: '33333333-3333-3333-3333-333333333333' });

    const insertOp = state.calls.find((c) => /INSERT INTO operators/i.test(c.sql));
    expect(insertOp, 'вставка оператора').toBeTruthy();
    expect(insertOp!.sql).toMatch(/'admin'/);
    // Пароль ушёл хешем, не в открытую.
    expect(String(insertOp!.params[2])).toMatch(/^\$argon2id\$/);

    const insertJournal = state.calls.find((c) => /INSERT INTO admin_action_journal/i.test(c.sql));
    expect(insertJournal, 'запись в журнал').toBeTruthy();
    expect(insertJournal!.params[2]).toBe('operator.bootstrap');
    expect(String(insertJournal!.params[5])).toContain('bootstrap');

    // Операция завершилась COMMIT, а не ROLLBACK.
    expect(state.calls.some((c) => /COMMIT/i.test(c.sql))).toBe(true);
    // Под блокировкой таблицы — чтобы два сида не проскочили гонкой.
    expect(state.calls.some((c) => /LOCK TABLE operators/i.test(c.sql))).toBe(true);
  });
});

describe('сид · повторный запуск', () => {
  it('таблица операторов не пуста → отказ, НИЧЕГО не вставлено', async () => {
    const state: FakeState = { operatorsEmpty: false, calls: [] };

    const result = await bootstrapFirstOperator(INPUT, fakePool(state));
    expect(result).toEqual({ ok: false, reason: 'alreadyBootstrapped' });

    expect(state.calls.some((c) => /INSERT INTO operators/i.test(c.sql))).toBe(false);
    expect(state.calls.some((c) => /INSERT INTO admin_action_journal/i.test(c.sql))).toBe(false);
    // И откат, а не коммит.
    expect(state.calls.some((c) => /ROLLBACK/i.test(c.sql))).toBe(true);
    expect(state.calls.some((c) => /COMMIT/i.test(c.sql))).toBe(false);
  });
});
