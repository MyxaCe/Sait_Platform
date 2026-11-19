import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperatorRole } from '../auth/session';

const session = vi.hoisted(() => ({ role: 'admin' as OperatorRole | null }));
const lib = vi.hoisted(() => ({
  initiateManualCredit: vi.fn(async () => ({ ok: true as const, commandId: 'c1', state: 'executed' as const, replay: false })),
  approveManualCredit: vi.fn(async () => ({ ok: true as const, commandId: 'c1', state: 'executed' as const })),
  retryManualCredit: vi.fn(async () => ({ ok: true as const, commandId: 'c1', state: 'executed' as const })),
  declineManualCredit: vi.fn(async () => ({ ok: true as const })),
}));

vi.mock('../auth/current', () => ({
  getOperatorSession: async () =>
    session.role ? { operatorId: 'op-1', role: session.role, displayName: 'Тест', login: 't' } : null,
}));
vi.mock('./manual-credit', () => lib);
vi.mock('../crypto/runtime', () => ({ terminalMoney: () => ({}) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const actions = await import('./credit-actions');

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const CREDIT = { userId: '11111111-1111-4111-8111-111111111111', amount: '250.00', reason: 'платёжка №1' };
const CMD = { commandId: '22222222-2222-4222-8222-222222222222', reason: 'сверено' };

beforeEach(() => {
  for (const fn of Object.values(lib)) fn.mockClear();
});

describe('прямой POST денежных экшенов: роль — из сессии', () => {
  for (const role of ['operator', 'support_operator'] as const) {
    it(`${role} → forbidden, до библиотеки дело не доходит`, async () => {
      session.role = role;
      expect(await actions.manualCreditAction({}, form(CREDIT))).toEqual({ error: 'forbidden' });
      expect(await actions.approveCreditAction({}, form(CMD))).toEqual({ error: 'forbidden' });
      expect(await actions.retryCreditAction({}, form(CMD))).toEqual({ error: 'forbidden' });
      expect(await actions.declineCreditAction({}, form(CMD))).toEqual({ error: 'forbidden' });
      for (const fn of Object.values(lib)) expect(fn).not.toHaveBeenCalled();
    });
  }

  it('без сессии — на вход', async () => {
    session.role = null;
    await expect(actions.manualCreditAction({}, form(CREDIT))).rejects.toThrow('redirect:/login');
  });

  it('admin: сумма в центах, личность и роль из сессии, а не из формы', async () => {
    session.role = 'admin';
    const r = await actions.manualCreditAction({}, form({ ...CREDIT, operatorId: 'подмена', role: 'admin' }));
    expect(r).toMatchObject({ ok: true });
    expect(lib.initiateManualCredit).toHaveBeenCalledWith(
      {
        actor: { operatorId: 'op-1', role: 'admin', login: 't' },
        userId: CREDIT.userId,
        amountMinor: 25_000,
        basis: 'платёжка №1',
      },
      expect.anything(),
    );
  });

  it('finance_operator: плохая сумма — отказ до библиотеки', async () => {
    session.role = 'finance_operator';
    expect(await actions.manualCreditAction({}, form({ ...CREDIT, amount: '-5' }))).toEqual({ error: 'invalidAmount' });
    expect(lib.initiateManualCredit).not.toHaveBeenCalled();
  });
});
