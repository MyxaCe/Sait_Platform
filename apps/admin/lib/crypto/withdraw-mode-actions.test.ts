import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperatorRole } from '../auth/session';

const session = vi.hoisted(() => ({ role: 'admin' as OperatorRole | null }));
const money = vi.hoisted(() => ({
  setWithdrawMode: vi.fn(async () => ({ ok: true as const, journalSeq: 7, before: 'manual', after: 'stop' })),
  setClientWithdrawManualOnly: vi.fn(async () => ({ ok: true as const, journalSeq: 8 })),
}));

vi.mock('../auth/current', () => ({
  getOperatorSession: async () =>
    session.role ? { operatorId: 'op-1', role: session.role, displayName: 'Тест', login: 't' } : null,
}));
vi.mock('@broker/money', async (orig) => ({ ...(await orig<Record<string, unknown>>()), ...money }));
vi.mock('./runtime', () => ({
  moneyPool: () => ({}),
  terminalMoney: () => ({}),
  canOperateMoney: (role: string | null | undefined) => role === 'admin' || role === 'finance_operator',
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const actions = await import('./actions');

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const USER = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  money.setWithdrawMode.mockClear();
  money.setClientWithdrawManualOnly.mockClear();
});

describe('режим вывода: права — из сессии', () => {
  for (const role of ['finance_operator', 'operator', 'support_operator'] as const) {
    it(`${role} не может сменить режим и нажать «Остановить выводы»`, async () => {
      session.role = role;
      expect(await actions.setWithdrawModeAction({}, form({ mode: 'manual', reason: 'x' }))).toEqual({
        error: 'forbidden',
      });
      expect(await actions.stopWithdrawalsAction({}, form({ reason: 'x' }))).toEqual({ error: 'forbidden' });
      expect(money.setWithdrawMode).not.toHaveBeenCalled();
    });
  }

  it('без сессии — на вход', async () => {
    session.role = null;
    await expect(actions.stopWithdrawalsAction({}, form({ reason: 'x' }))).rejects.toThrow('redirect:/login');
  });

  it('admin: «Остановить выводы» — всегда режим stop, оператор из сессии', async () => {
    session.role = 'admin';
    const r = await actions.stopWithdrawalsAction({}, form({ reason: 'атака ботов', mode: 'manual', operatorId: 'подмена' }));
    expect(r).toEqual({ ok: true });
    expect(money.setWithdrawMode).toHaveBeenCalledWith({}, { operatorId: 'op-1', reason: 'атака ботов', mode: 'stop' });
  });

  it('admin: повторный «Стоп» — понятное сообщение, а не «изменений нет»', async () => {
    session.role = 'admin';
    money.setWithdrawMode.mockResolvedValueOnce({ ok: false, reason: 'noChange' } as never);
    expect(await actions.stopWithdrawalsAction({}, form({ reason: 'x' }))).toEqual({ error: 'alreadyStopped' });
  });

  it('admin: смена режима передаёт выбранный режим и основание', async () => {
    session.role = 'admin';
    await actions.setWithdrawModeAction({}, form({ mode: 'auto', reason: 'проба' }));
    expect(money.setWithdrawMode).toHaveBeenCalledWith({}, { operatorId: 'op-1', reason: 'проба', mode: 'auto' });
  });
});

describe('флаг «только ручной вывод»: admin и finance_operator', () => {
  for (const role of ['admin', 'finance_operator'] as const) {
    it(`${role} ставит флаг`, async () => {
      session.role = role;
      const r = await actions.setClientWithdrawManualOnlyAction({}, form({ userId: USER, reason: 'подозрение', manualOnly: 'on' }));
      expect(r).toEqual({ ok: true });
      expect(money.setClientWithdrawManualOnly).toHaveBeenCalledWith({}, {
        operatorId: 'op-1',
        userId: USER,
        reason: 'подозрение',
        value: true,
      });
    });
  }

  it('operator не может', async () => {
    session.role = 'operator';
    expect(await actions.setClientWithdrawManualOnlyAction({}, form({ userId: USER, reason: 'x' }))).toEqual({
      error: 'forbidden',
    });
    expect(money.setClientWithdrawManualOnly).not.toHaveBeenCalled();
  });

  it('снятая галочка — снять флаг', async () => {
    session.role = 'admin';
    await actions.setClientWithdrawManualOnlyAction({}, form({ userId: USER, reason: 'проверен' }));
    expect(money.setClientWithdrawManualOnly).toHaveBeenCalledWith({}, expect.objectContaining({ value: false }));
  });
});
