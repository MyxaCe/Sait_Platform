import { describe, expect, it } from 'vitest';
import type { Queryable } from '../db';
import { asRole, listOperators } from './queries';

/**
 * Регресс: раздел «Операторы» падал, если в базе был оператор с ролью
 * finance_operator (роль введена миграцией 1794150000000, а чтение списка
 * знало только admin|operator).
 */
describe('asRole', () => {
  it('принимает все три роли', () => {
    expect(asRole('admin')).toBe('admin');
    expect(asRole('operator')).toBe('operator');
    expect(asRole('finance_operator')).toBe('finance_operator');
  });

  it('fail-closed на неизвестной роли', () => {
    expect(() => asRole('root')).toThrow(/вне допустимого множества/);
    expect(() => asRole(null)).toThrow();
  });
});

describe('listOperators', () => {
  it('не падает на операторе с ролью finance_operator', async () => {
    const db = {
      async query() {
        return {
          rows: [
            {
              id: 'a',
              login: 'fin',
              display_name: 'Финансист',
              role: 'finance_operator',
              created_at: '2026-11-01T10:00:00Z',
              disabled_at: null,
              totp_enrolled_at: '2026-11-01T10:05:00Z',
            },
          ],
        };
      },
    } as unknown as Queryable;
    const list = await listOperators(db);
    expect(list).toHaveLength(1);
    expect(list[0]?.role).toBe('finance_operator');
    expect(list[0]?.totpEnrolled).toBe(true);
  });
});
