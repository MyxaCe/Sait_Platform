import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDb, FakeTerminal } from '@broker/money/testing';
import { USDT_TRC20_CONTRACT } from '@broker/money';

/**
 * Экшены ввода/вывода кабинета на фейках `@broker/money` (ни одного
 * сетевого вызова): userId — из сессии, исход виден человеку ключом
 * перевода, политика проверяется сервером, а не кнопкой.
 */

const env = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  term: null as unknown as FakeTerminal,
  user: { id: 'user-1' } as { id: string } | null,
}));

vi.mock('./money', () => ({
  moneyPool: () => env.db,
  terminalMoney: () => env.term,
}));
vi.mock('./auth/session', () => ({ getSessionUser: async () => env.user }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(async () => {
  env.db = new FakeDb();
  env.db.clients.set('user-1', { kycState: 'verified' });
  env.term = new FakeTerminal();
  env.term.balances.set('user-1', 10_000);
  env.user = { id: 'user-1' };
  const { __resetRateLimit } = await import('./rate-limit');
  __resetRateLimit();
});

describe('claimDepositAction', () => {
  it('хэш принят; повтор того же хэша — alreadyClaimed', async () => {
    const { claimDepositAction } = await import('./money-actions');
    expect(await claimDepositAction({}, fd({ txHash: 'a'.repeat(64) }))).toEqual({ ok: true });
    expect(await claimDepositAction({}, fd({ txHash: 'a'.repeat(64) }))).toEqual({ error: 'alreadyClaimed' });
  });

  it('заблокирован/KYC — причины политики видны', async () => {
    env.db.clients.set('user-1', { blocked: true });
    const { claimDepositAction } = await import('./money-actions');
    expect(await claimDepositAction({}, fd({ txHash: 'b'.repeat(64) }))).toEqual({
      error: 'policy',
      reasons: ['blocked'],
    });
  });

  it('без сессии — ничего не пишется', async () => {
    env.user = null;
    const { claimDepositAction } = await import('./money-actions');
    expect(await claimDepositAction({}, fd({ txHash: 'c'.repeat(64) }))).toEqual({ error: 'unauthorized' });
    expect(env.db.deposits.size).toBe(0);
  });
});

describe('requestWithdrawalAction', () => {
  it('успех: сумма зарезервирована в терминале', async () => {
    const { requestWithdrawalAction } = await import('./money-actions');
    const r = await requestWithdrawalAction({}, fd({ address: USDT_TRC20_CONTRACT, amount: '25.50' }));
    expect(r).toEqual({ ok: true, pending: false });
    expect(env.term.balances.get('user-1')).toBe(10_000 - 2550);
  });

  it('нет свободной маржи — понятный ключ ошибки, заявка отклонена', async () => {
    const { requestWithdrawalAction } = await import('./money-actions');
    const r = await requestWithdrawalAction({}, fd({ address: USDT_TRC20_CONTRACT, amount: '500' }));
    expect(r).toEqual({ error: 'terminal_insufficient_free_margin' });
    expect([...env.db.withdrawals.values()][0]!.status).toBe('rejected');
  });

  it('ошибки суммы и адреса — до записи', async () => {
    const { requestWithdrawalAction } = await import('./money-actions');
    expect(await requestWithdrawalAction({}, fd({ address: USDT_TRC20_CONTRACT, amount: '1.234' }))).toEqual({
      error: 'amount_tooPrecise',
    });
    expect(await requestWithdrawalAction({}, fd({ address: 'TXYZ', amount: '20' }))).toEqual({ error: 'invalidAddress' });
    expect(env.db.withdrawals.size).toBe(0);
  });

  it('заморозка — вывод закрыт политикой', async () => {
    env.db.clients.set('user-1', { kycState: 'verified', frozen: true });
    const { requestWithdrawalAction } = await import('./money-actions');
    expect(await requestWithdrawalAction({}, fd({ address: USDT_TRC20_CONTRACT, amount: '20' }))).toEqual({
      error: 'policy',
      reasons: ['frozen'],
    });
    expect(env.term.calls).toHaveLength(0);
  });
});
