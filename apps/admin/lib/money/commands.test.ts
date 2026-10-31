import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initiateCommand, secondApprove, signCommand } from './commands';
import { generateEd25519KeyPair, StaticEd25519KeyProvider } from './signing';
import type { MoneyCommandState, MoneyCommandType } from './types';

/**
 * Р-452 · оркестрация dual control на фейковом пуле (БД замокана, как в
 * `bootstrap.test.ts`). Проверяем: каждый переход журналируется, запрет
 * self-approval держится и на уровне оркестрации, транзакция коммитится/
 * откатывается верно. Деньги НЕ двигаются — путь намерения и аудита.
 */

const { privateKey, publicKey } = generateEd25519KeyPair();
const keyProvider = new StaticEd25519KeyProvider(privateKey, publicKey, 'v1');

interface Call {
  sql: string;
  params: unknown[];
}

/** Строка команды, которую вернёт `SELECT ... FOR UPDATE`. */
interface FakeRow {
  id: string;
  state: MoneyCommandState;
  initiator_id: string;
  type: MoneyCommandType;
  account_id: string;
  amount_minor: string;
  currency: string;
  scale: number;
  basis_ref: string;
  nonce: string;
  break_glass: boolean;
}

function fakePool(opts: { calls: Call[]; row?: FakeRow; updateSignedRows?: number }) {
  let seq = 100;
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      opts.calls.push({ sql, params });
      if (/FOR UPDATE/i.test(sql)) {
        return { rows: opts.row ? [opts.row] : [] };
      }
      if (/UPDATE money_commands SET state = 'signed'/i.test(sql)) {
        const n = opts.updateSignedRows ?? 1;
        return { rows: n > 0 ? [{ id: opts.row?.id ?? 'cmd' }] : [] };
      }
      if (/SELECT seq FROM admin_action_journal WHERE entry_hash/i.test(sql)) {
        return { rows: [{ seq: ++seq }] };
      }
      if (/SELECT entry_hash FROM admin_action_journal/i.test(sql)) {
        return { rows: [] }; // prevHash = null
      }
      return { rows: [] };
    },
    release: () => {},
  };
  return { connect: async () => client as never };
}

const BASE = {
  initiatorId: 'op-A',
  type: 'adjustment' as MoneyCommandType,
  accountId: 'acc-1',
  amount: { amountMinor: '500', currency: 'USD', scale: 2 },
  basisRef: 'TICKET-1',
};

beforeEach(() => {
  process.env.MONEY_DUAL_CONTROL_THRESHOLD_MINOR = '1000';
});
afterEach(() => {
  delete process.env.MONEY_DUAL_CONTROL_THRESHOLD_MINOR;
});

describe('initiateCommand', () => {
  it('ниже порога → draft, пишет команду, аппрув-инициацию и журнал', async () => {
    const calls: Call[] = [];
    const res = await initiateCommand(BASE, { pool: fakePool({ calls }), keyProvider });
    expect(res).toMatchObject({ ok: true, state: 'draft' });

    const insCmd = calls.find((c) => /INSERT INTO money_commands/i.test(c.sql));
    expect(insCmd, 'вставка команды').toBeTruthy();
    expect(insCmd!.params).toContain('draft');

    const insApproval = calls.find((c) => /INSERT INTO money_command_approvals/i.test(c.sql));
    expect(insApproval!.sql).toMatch(/'initiate'/);

    const journalIns = calls.filter((c) => /INSERT INTO admin_action_journal/i.test(c.sql));
    expect(journalIns.length).toBeGreaterThanOrEqual(1);
    expect(journalIns[0]!.params[2]).toBe('money.command.initiated');

    expect(calls.some((c) => /COMMIT/i.test(c.sql))).toBe(true);
  });

  it('выше порога → awaiting_second_approval', async () => {
    const calls: Call[] = [];
    const res = await initiateCommand(
      { ...BASE, amount: { amountMinor: '5000', currency: 'USD', scale: 2 } },
      { pool: fakePool({ calls }), keyProvider },
    );
    expect(res).toMatchObject({ ok: true, state: 'awaiting_second_approval' });
    const insCmd = calls.find((c) => /INSERT INTO money_commands/i.test(c.sql));
    expect(insCmd!.params).toContain('awaiting_second_approval');
  });

  it('break-glass без причины → отказ, ничего не вставлено', async () => {
    const calls: Call[] = [];
    const res = await initiateCommand(
      { ...BASE, breakGlass: true },
      { pool: fakePool({ calls }), keyProvider },
    );
    expect(res).toEqual({ ok: false, reason: 'missingBreakGlassReason' });
    expect(calls.some((c) => /INSERT INTO money_commands/i.test(c.sql))).toBe(false);
  });

  it('пустое основание → отказ', async () => {
    const res = await initiateCommand(
      { ...BASE, basisRef: '  ' },
      { pool: fakePool({ calls: [] }), keyProvider },
    );
    expect(res).toEqual({ ok: false, reason: 'missingBasis' });
  });

  it('break-glass с причиной → draft и запись break_glass в журнал', async () => {
    const calls: Call[] = [];
    const res = await initiateCommand(
      { ...BASE, amount: { amountMinor: '9000', currency: 'USD', scale: 2 }, breakGlass: true, breakGlassReason: 'инцидент INC-7' },
      { pool: fakePool({ calls }), keyProvider },
    );
    expect(res).toMatchObject({ ok: true, state: 'draft' });
    const actions = calls
      .filter((c) => /INSERT INTO admin_action_journal/i.test(c.sql))
      .map((c) => c.params[2]);
    expect(actions).toContain('money.command.break_glass');
  });
});

const ROW: FakeRow = {
  id: 'cmd-1',
  state: 'awaiting_second_approval',
  initiator_id: 'op-A',
  type: 'adjustment',
  account_id: 'acc-1',
  amount_minor: '5000',
  currency: 'USD',
  scale: 2,
  basis_ref: 'TICKET-1',
  nonce: 'nonce-1',
  break_glass: false,
};

describe('secondApprove', () => {
  it('другой оператор → signed, подписывает и журналирует', async () => {
    const calls: Call[] = [];
    const res = await secondApprove('cmd-1', 'op-B', {
      pool: fakePool({ calls, row: ROW }),
      keyProvider,
    });
    expect(res).toEqual({ ok: true, state: 'signed' });

    const insApproval = calls.find((c) => /INSERT INTO money_command_approvals/i.test(c.sql));
    expect(insApproval!.sql).toMatch(/'second_approval'/);

    const sigUpdate = calls.find((c) => /UPDATE money_commands\s+SET signature/i.test(c.sql));
    expect(sigUpdate, 'подпись записана').toBeTruthy();

    const journaled = calls
      .filter((c) => /INSERT INTO admin_action_journal/i.test(c.sql))
      .map((c) => c.params[2]);
    expect(journaled).toContain('money.command.second_approved');
    expect(calls.some((c) => /COMMIT/i.test(c.sql))).toBe(true);
  });

  it('self-approval (инициатор = аппрувер) → отказ, откат, второй аппрув НЕ записан', async () => {
    const calls: Call[] = [];
    const res = await secondApprove('cmd-1', 'op-A', {
      pool: fakePool({ calls, row: ROW }),
      keyProvider,
    });
    expect(res).toEqual({ ok: false, reason: 'selfApprovalForbidden' });
    expect(calls.some((c) => /second_approval/i.test(c.sql))).toBe(false);
    expect(calls.some((c) => /ROLLBACK/i.test(c.sql))).toBe(true);
    expect(calls.some((c) => /COMMIT/i.test(c.sql))).toBe(false);
  });

  it('команды нет → notFound', async () => {
    const res = await secondApprove('cmd-x', 'op-B', {
      pool: fakePool({ calls: [] }),
      keyProvider,
    });
    expect(res).toEqual({ ok: false, reason: 'notFound' });
  });
});

describe('signCommand', () => {
  it('draft ниже порога → signed с подписью', async () => {
    const calls: Call[] = [];
    const row: FakeRow = { ...ROW, state: 'draft', amount_minor: '500' };
    const res = await signCommand('cmd-1', { pool: fakePool({ calls, row }), keyProvider });
    expect(res).toEqual({ ok: true, state: 'signed' });
    expect(calls.some((c) => /UPDATE money_commands\s+SET signature/i.test(c.sql))).toBe(true);
    expect(
      calls.filter((c) => /INSERT INTO admin_action_journal/i.test(c.sql)).map((c) => c.params[2]),
    ).toContain('money.command.signed');
  });

  it('draft ВЫШЕ порога без второго аппрува → secondApprovalRequired, откат', async () => {
    const calls: Call[] = [];
    const row: FakeRow = { ...ROW, state: 'draft', amount_minor: '5000' };
    const res = await signCommand('cmd-1', { pool: fakePool({ calls, row }), keyProvider });
    expect(res).toEqual({ ok: false, reason: 'secondApprovalRequired' });
    expect(calls.some((c) => /UPDATE money_commands\s+SET signature/i.test(c.sql))).toBe(false);
    expect(calls.some((c) => /ROLLBACK/i.test(c.sql))).toBe(true);
  });
});
