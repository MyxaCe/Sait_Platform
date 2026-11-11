import { describe, expect, it, vi } from 'vitest';
import type { PoolLike, TxClient } from '@broker/money';
import { FakeTerminal } from '@broker/money/testing';

vi.mock('../db', () => ({
  getPool: () => {
    throw new Error('пул не должен трогаться — тест подаёт фейк');
  },
}));

import { setClientMoneyFlags } from './flags';
import { updatePlatformMoneySettings } from './settings';

/**
 * Денежные флаги клиента и настройки платформы: основание обязательно,
 * журнал той же транзакцией, заморозка — сначала терминал (fail-closed).
 */

const U = 'user-1';
const OP = 'op-1';

function fake() {
  const state = {
    exists: true,
    flags: null as null | { deposit_kyc: string; withdraw_kyc: string; frozen: boolean; withdraw_banned: boolean },
    settings: { deposit_requires_kyc: false, withdraw_requires_kyc: true, min_deposit_minor: 1000, min_withdraw_minor: 1000, unverified_withdraw_bps: 500 },
    journal: [] as { action: string; payload: Record<string, unknown>; entry_hash: string }[],
    committed: 0,
    rolledBack: 0,
  };
  let snap: string | null = null;
  const client: TxClient = {
    async query(sql: string, p: unknown[] = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s === 'BEGIN') {
        snap = JSON.stringify({ flags: state.flags, settings: state.settings, journal: state.journal });
        return { rows: [] };
      }
      if (s === 'COMMIT') return state.committed++, { rows: [] };
      if (s === 'ROLLBACK') {
        Object.assign(state, JSON.parse(snap!));
        state.rolledBack++;
        return { rows: [] };
      }
      if (s.startsWith('SELECT 1 FROM users')) return { rows: state.exists ? [{}] : [] };
      if (s.startsWith('INSERT INTO client_money_flags')) {
        state.flags ??= { deposit_kyc: 'inherit', withdraw_kyc: 'inherit', frozen: false, withdraw_banned: false };
        return { rows: [] };
      }
      if (s.startsWith('SELECT deposit_kyc, withdraw_kyc, frozen,')) return { rows: [{ ...state.flags }] };
      if (s.startsWith('UPDATE client_money_flags SET deposit_kyc')) {
        state.flags = { deposit_kyc: p[1] as string, withdraw_kyc: p[2] as string, frozen: p[3] as boolean, withdraw_banned: p[4] as boolean };
        return { rows: [] };
      }
      if (s.startsWith('UPDATE client_money_flags SET last_journal_seq')) return { rows: [] };
      if (s.startsWith('INSERT INTO platform_money_settings')) return { rows: [] };
      if (s.startsWith('SELECT id FROM platform_money_settings')) return { rows: [{ id: 1 }] };
      if (s.startsWith('SELECT deposit_requires_kyc')) return { rows: [{ ...state.settings }] };
      if (s.startsWith('UPDATE platform_money_settings SET deposit_requires_kyc')) {
        state.settings = { deposit_requires_kyc: p[0] as boolean, withdraw_requires_kyc: p[1] as boolean, min_deposit_minor: p[2] as number, min_withdraw_minor: p[3] as number, unverified_withdraw_bps: p[5] as number };
        return { rows: [] };
      }
      if (s.startsWith('UPDATE platform_money_settings SET last_journal_seq')) return { rows: [] };
      if (s.includes('pg_advisory_xact_lock')) return { rows: [{}] };
      if (s.startsWith('SELECT entry_hash FROM admin_action_journal')) {
        const last = state.journal.at(-1);
        return { rows: last ? [{ entry_hash: last.entry_hash }] : [] };
      }
      if (s.startsWith('INSERT INTO admin_action_journal')) {
        state.journal.push({ action: p[2] as string, payload: JSON.parse(p[5] as string), entry_hash: p[7] as string });
        return { rows: [] };
      }
      if (s.startsWith('SELECT seq FROM admin_action_journal')) {
        const i = state.journal.findIndex((j) => j.entry_hash === p[0]);
        return { rows: i >= 0 ? [{ seq: i + 1 }] : [] };
      }
      throw new Error(`unexpected sql: ${s.slice(0, 100)}`);
    },
    release() {},
  };
  const pool: PoolLike = { connect: async () => client, query: client.query };
  return { state, pool };
}

const NEXT = { depositKyc: 'inherit' as const, withdrawKyc: 'inherit' as const, frozen: false, withdrawBanned: false };

describe('денежные флаги клиента', () => {
  it('заморозка: сначала terminal trading-freeze(real), потом флаг + журнал client.money.frozen', async () => {
    const { state, pool } = fake();
    const term = new FakeTerminal();
    const r = await setClientMoneyFlags(
      { operatorId: OP, operatorLogin: 'admin', userId: U, reason: 'AML-кейс 7', next: { ...NEXT, frozen: true } },
      pool,
      term,
    );
    expect(r).toEqual({ ok: true, changed: ['frozen'] });
    expect(term.frozen.get(U)).toBe(true);
    expect(state.flags?.frozen).toBe(true);
    expect(state.journal.map((j) => j.action)).toEqual(['client.money.frozen']);
    expect(state.journal[0]!.payload).toMatchObject({ basis: 'AML-кейс 7', before: false, after: true });
  });

  it('терминал не ответил/отказал — флаг НЕ ставится, журнала нет (fail-closed)', async () => {
    for (const mode of ['unavailable', 'account_quarantined']) {
      const { state, pool } = fake();
      const term = new FakeTerminal();
      term.next = [mode];
      const r = await setClientMoneyFlags(
        { operatorId: OP, operatorLogin: 'admin', userId: U, reason: 'x', next: { ...NEXT, frozen: true } },
        pool,
        term,
      );
      expect(r.ok).toBe(false);
      expect(r).toMatchObject(
        mode === 'unavailable' ? { reason: 'terminalUnavailable' } : { reason: 'terminalRefused', code: mode },
      );
      expect(state.flags?.frozen ?? false).toBe(false);
      expect(state.journal).toHaveLength(0);
    }
  });

  it('KYC-гейт и запрет вывода — терминал не вызывается, по записи журнала на поле', async () => {
    const { state, pool } = fake();
    const term = new FakeTerminal();
    const r = await setClientMoneyFlags(
      {
        operatorId: OP,
        operatorLogin: 'admin',
        userId: U,
        reason: 'по заявке',
        next: { ...NEXT, withdrawKyc: 'not_required', withdrawBanned: true },
      },
      pool,
      term,
    );
    expect(r).toEqual({ ok: true, changed: ['withdrawKyc', 'withdrawBanned'] });
    expect(term.calls).toHaveLength(0);
    expect(state.journal.map((j) => j.action)).toEqual([
      'client.money.withdraw_kyc_changed',
      'client.money.withdraw_banned',
    ]);
  });

  it('без основания / без изменений / нет клиента — ничего', async () => {
    const term = new FakeTerminal();
    expect(
      await setClientMoneyFlags({ operatorId: OP, operatorLogin: 'a', userId: U, reason: ' ', next: NEXT }, fake().pool, term),
    ).toEqual({ ok: false, reason: 'missingReason' });
    expect(
      await setClientMoneyFlags({ operatorId: OP, operatorLogin: 'a', userId: U, reason: 'x', next: NEXT }, fake().pool, term),
    ).toEqual({ ok: false, reason: 'noChange' });
    const f = fake();
    f.state.exists = false;
    expect(
      await setClientMoneyFlags({ operatorId: OP, operatorLogin: 'a', userId: U, reason: 'x', next: NEXT }, f.pool, term),
    ).toEqual({ ok: false, reason: 'noClient' });
  });
});

describe('настройки платформы', () => {
  const NEXT_S = { depositRequiresKyc: true, withdrawRequiresKyc: true, minDepositMinor: 2000, minWithdrawMinor: 1000, unverifiedWithdrawBps: 500 };

  it('изменение с основанием → журнал platform.money_settings.updated (до/после)', async () => {
    const { state, pool } = fake();
    const r = await updatePlatformMoneySettings({ operatorId: OP, reason: 'решение владельца', next: NEXT_S }, pool);
    expect(r).toMatchObject({ ok: true });
    expect(state.settings).toMatchObject({ deposit_requires_kyc: true, min_deposit_minor: 2000 });
    expect(state.journal[0]!.action).toBe('platform.money_settings.updated');
    expect(state.journal[0]!.payload.changed).toEqual(['depositRequiresKyc', 'minDepositMinor']);
  });

  it('без основания, без изменений, неверный минимум — отказ', async () => {
    expect(await updatePlatformMoneySettings({ operatorId: OP, reason: '', next: NEXT_S }, fake().pool)).toEqual({
      ok: false,
      reason: 'missingReason',
    });
    expect(
      await updatePlatformMoneySettings(
        { operatorId: OP, reason: 'x', next: { depositRequiresKyc: false, withdrawRequiresKyc: true, minDepositMinor: 1000, minWithdrawMinor: 1000, unverifiedWithdrawBps: 500 } },
        fake().pool,
      ),
    ).toEqual({ ok: false, reason: 'noChange' });
    expect(
      await updatePlatformMoneySettings({ operatorId: OP, reason: 'x', next: { ...NEXT_S, minWithdrawMinor: -1 } }, fake().pool),
    ).toEqual({ ok: false, reason: 'invalidMinimum' });
    for (const bad of [-1, 10_001, 2.5]) {
      expect(
        await updatePlatformMoneySettings({ operatorId: OP, reason: 'x', next: { ...NEXT_S, unverifiedWithdrawBps: bad } }, fake().pool),
      ).toEqual({ ok: false, reason: 'invalidPercent' });
    }
  });

  it('доля вывода без верификации: изменение одной доли пишется в журнал (до/после)', async () => {
    const { state, pool } = fake();
    const r = await updatePlatformMoneySettings(
      { operatorId: OP, reason: 'решение владельца', next: { ...NEXT_S, depositRequiresKyc: false, minDepositMinor: 1000, unverifiedWithdrawBps: 250 } },
      pool,
    );
    expect(r).toMatchObject({ ok: true });
    expect(state.settings.unverified_withdraw_bps).toBe(250);
    expect(state.journal[0]!.payload).toMatchObject({
      changed: ['unverifiedWithdrawBps'],
      before: { unverifiedWithdrawBps: 500 },
      after: { unverifiedWithdrawBps: 250 },
    });
  });
});
