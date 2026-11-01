import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminAlertPort, MoneyAlert } from './alerts';
import { initiateCommand, reviewBreakGlass, secondApprove, signCommand } from './commands';
import { generateEd25519KeyPair, StaticEd25519KeyProvider } from './signing';
import type { MoneyCommandState, MoneyCommandType, MoneyInitiatorRole } from './types';

/**
 * Р-452/Р-455/Р-456 · оркестрация dual control на фейковом пуле (БД замокана,
 * как в `bootstrap.test.ts`). Проверяем: каждый переход журналируется, запрет
 * self-approval держится, admin освобождён от второго аппрува ТОЛЬКО в
 * bootstrap-режиме (Р-456 C) с алертом+записью, break-glass только admin с
 * инцидентом и алертом (R-5), reversal требует исходную команду (R-4), в подпись
 * кладутся id аппрувов (R-1). Деньги НЕ двигаются — путь намерения и аудита.
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
  initiator_role: MoneyInitiatorRole;
  type: MoneyCommandType;
  account_id: string;
  amount_minor: string;
  currency: string;
  scale: number;
  basis_ref: string;
  original_command_id: string | null;
  nonce: string;
  break_glass: boolean;
  bootstrap_mode: boolean;
}

function fakePool(opts: { calls: Call[]; row?: FakeRow; updateSignedRows?: number }) {
  let seq = 100;
  // Р-455 R-1: запрос id аппрувов. Сидируем инициацию; второй аппрув докидывается
  // при INSERT ... 'second_approval' в этой же сессии.
  const approvals: Array<{ kind: string; id: string }> = [{ kind: 'initiate', id: 'appr-init' }];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      opts.calls.push({ sql, params });
      if (/INSERT INTO money_command_approvals/i.test(sql)) {
        const kind = /'second_approval'/.test(sql) ? 'second_approval' : 'initiate';
        approvals.push({ kind, id: String(params[0]) });
        return { rows: [] };
      }
      if (/SELECT kind, id FROM money_command_approvals/i.test(sql)) {
        return { rows: approvals };
      }
      if (/FOR UPDATE/i.test(sql)) {
        return { rows: opts.row ? [opts.row] : [] };
      }
      if (/UPDATE money_commands SET state = 'signed'/i.test(sql)) {
        const n = opts.updateSignedRows ?? 1;
        return { rows: n > 0 ? [{ id: opts.row?.id ?? 'cmd' }] : [] };
      }
      if (/UPDATE money_commands\s+SET reviewed_at/i.test(sql)) {
        return { rows: [{ id: opts.row?.id ?? 'cmd' }] };
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
  initiatorRole: 'finance_operator' as MoneyInitiatorRole,
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
  delete process.env.MONEY_BOOTSTRAP_MODE;
});

describe('initiateCommand', () => {
  it('finance_operator ниже порога → draft, пишет команду, аппрув-инициацию и журнал', async () => {
    const calls: Call[] = [];
    const res = await initiateCommand(BASE, { pool: fakePool({ calls }), keyProvider });
    expect(res).toMatchObject({ ok: true, state: 'draft' });

    const insCmd = calls.find((c) => /INSERT INTO money_commands/i.test(c.sql));
    expect(insCmd, 'вставка команды').toBeTruthy();
    expect(insCmd!.params).toContain('draft');
    expect(insCmd!.params).toContain('finance_operator');

    const insApproval = calls.find((c) => /INSERT INTO money_command_approvals/i.test(c.sql));
    expect(insApproval!.sql).toMatch(/'initiate'/);

    const journalIns = calls.filter((c) => /INSERT INTO admin_action_journal/i.test(c.sql));
    expect(journalIns.length).toBeGreaterThanOrEqual(1);
    expect(journalIns[0]!.params[2]).toBe('money.command.initiated');

    expect(calls.some((c) => /COMMIT/i.test(c.sql))).toBe(true);
  });

  it('finance_operator выше порога → awaiting_second_approval', async () => {
    const calls: Call[] = [];
    const res = await initiateCommand(
      { ...BASE, amount: { amountMinor: '5000', currency: 'USD', scale: 2 } },
      { pool: fakePool({ calls }), keyProvider },
    );
    expect(res).toMatchObject({ ok: true, state: 'awaiting_second_approval' });
    const insCmd = calls.find((c) => /INSERT INTO money_commands/i.test(c.sql));
    expect(insCmd!.params).toContain('awaiting_second_approval');
  });

  it('Р-456 C: admin ПРИ bootstrap → draft даже выше порога, bootstrap_mode в INSERT', async () => {
    process.env.MONEY_BOOTSTRAP_MODE = 'true';
    const calls: Call[] = [];
    const res = await initiateCommand(
      { ...BASE, initiatorRole: 'admin', amount: { amountMinor: '9999999', currency: 'USD', scale: 2 } },
      { pool: fakePool({ calls }), keyProvider },
    );
    expect(res).toMatchObject({ ok: true, state: 'draft' });
    const insCmd = calls.find((c) => /INSERT INTO money_commands/i.test(c.sql));
    expect(insCmd!.params).toContain('admin');
    expect(insCmd!.params).toContain('draft');
    expect(insCmd!.params).toContain(true); // bootstrap_mode зафиксирован на команде
  });

  it('Р-456 C: admin БЕЗ bootstrap → awaiting_second_approval выше порога (освобождение снято)', async () => {
    const calls: Call[] = [];
    const res = await initiateCommand(
      { ...BASE, initiatorRole: 'admin', amount: { amountMinor: '9999999', currency: 'USD', scale: 2 } },
      { pool: fakePool({ calls }), keyProvider },
    );
    expect(res).toMatchObject({ ok: true, state: 'awaiting_second_approval' });
  });

  it('Р-455 R-3: чужая роль (operator) → forbiddenRole, ничего не вставлено', async () => {
    const calls: Call[] = [];
    const res = await initiateCommand(
      { ...BASE, initiatorRole: 'operator' as MoneyInitiatorRole },
      { pool: fakePool({ calls }), keyProvider },
    );
    expect(res).toEqual({ ok: false, reason: 'forbiddenRole' });
    expect(calls.some((c) => /INSERT INTO money_commands/i.test(c.sql))).toBe(false);
  });

  it('Р-455 R-4: reversal без исходной команды → missingOriginalCommand', async () => {
    const res = await initiateCommand(
      { ...BASE, type: 'reversal' },
      { pool: fakePool({ calls: [] }), keyProvider },
    );
    expect(res).toEqual({ ok: false, reason: 'missingOriginalCommand' });
  });

  it('Р-455 R-4: reversal с исходной командой → ok, original_command_id в INSERT', async () => {
    const calls: Call[] = [];
    const res = await initiateCommand(
      { ...BASE, type: 'reversal', originalCommandId: 'cmd-orig' },
      { pool: fakePool({ calls }), keyProvider },
    );
    expect(res).toMatchObject({ ok: true });
    const insCmd = calls.find((c) => /INSERT INTO money_commands/i.test(c.sql));
    expect(insCmd!.params).toContain('cmd-orig');
  });

  it('Р-455 R-5: break-glass не-админом → breakGlassAdminOnly', async () => {
    const calls: Call[] = [];
    const res = await initiateCommand(
      { ...BASE, breakGlass: true, breakGlassReason: 'инцидент', incidentRef: 'INC-7' },
      { pool: fakePool({ calls }), keyProvider },
    );
    expect(res).toEqual({ ok: false, reason: 'breakGlassAdminOnly' });
    expect(calls.some((c) => /INSERT INTO money_commands/i.test(c.sql))).toBe(false);
  });

  it('break-glass admin без причины → missingBreakGlassReason', async () => {
    const res = await initiateCommand(
      { ...BASE, initiatorRole: 'admin', breakGlass: true, incidentRef: 'INC-7' },
      { pool: fakePool({ calls: [] }), keyProvider },
    );
    expect(res).toEqual({ ok: false, reason: 'missingBreakGlassReason' });
  });

  it('Р-455 R-5: break-glass admin без инцидента → missingIncident', async () => {
    const res = await initiateCommand(
      { ...BASE, initiatorRole: 'admin', breakGlass: true, breakGlassReason: 'срочно чиним' },
      { pool: fakePool({ calls: [] }), keyProvider },
    );
    expect(res).toEqual({ ok: false, reason: 'missingIncident' });
  });

  it('пустое основание → отказ', async () => {
    const res = await initiateCommand(
      { ...BASE, basisRef: '  ' },
      { pool: fakePool({ calls: [] }), keyProvider },
    );
    expect(res).toEqual({ ok: false, reason: 'missingBasis' });
  });

  it('Р-455 R-5: break-glass admin с причиной+инцидентом → draft, журнал break_glass, алерт всем админам', async () => {
    const calls: Call[] = [];
    const alertAllAdmins = vi.fn(async (_alert: MoneyAlert) => {});
    const alert: AdminAlertPort = { alertAllAdmins };
    const res = await initiateCommand(
      {
        ...BASE,
        initiatorRole: 'admin',
        amount: { amountMinor: '9000', currency: 'USD', scale: 2 },
        breakGlass: true,
        breakGlassReason: 'инцидент INC-7',
        incidentRef: 'INC-7',
      },
      { pool: fakePool({ calls }), keyProvider, adminAlert: alert },
    );
    expect(res).toMatchObject({ ok: true, state: 'draft' });
    const actions = calls
      .filter((c) => /INSERT INTO admin_action_journal/i.test(c.sql))
      .map((c) => c.params[2]);
    expect(actions).toContain('money.command.break_glass');
    expect(alertAllAdmins).toHaveBeenCalledTimes(1);
    expect(alertAllAdmins.mock.calls[0]![0]).toMatchObject({ kind: 'break_glass', incidentRef: 'INC-7' });
  });
});

const ROW: FakeRow = {
  id: 'cmd-1',
  state: 'awaiting_second_approval',
  initiator_id: 'op-A',
  initiator_role: 'finance_operator',
  type: 'adjustment',
  account_id: 'acc-1',
  amount_minor: '5000',
  currency: 'USD',
  scale: 2,
  basis_ref: 'TICKET-1',
  original_command_id: null,
  nonce: 'nonce-1',
  break_glass: false,
  bootstrap_mode: false,
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
    expect(calls.some((c) => /INSERT INTO money_command_approvals/i.test(c.sql))).toBe(false);
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
  it('finance_operator draft ниже порога → signed с подписью', async () => {
    const calls: Call[] = [];
    const row: FakeRow = { ...ROW, state: 'draft', amount_minor: '500' };
    const res = await signCommand('cmd-1', { pool: fakePool({ calls, row }), keyProvider });
    expect(res).toEqual({ ok: true, state: 'signed' });
    expect(calls.some((c) => /UPDATE money_commands\s+SET signature/i.test(c.sql))).toBe(true);
    expect(
      calls.filter((c) => /INSERT INTO admin_action_journal/i.test(c.sql)).map((c) => c.params[2]),
    ).toContain('money.command.signed');
  });

  it('finance_operator draft ВЫШЕ порога без второго аппрува → secondApprovalRequired, откат', async () => {
    const calls: Call[] = [];
    const row: FakeRow = { ...ROW, state: 'draft', amount_minor: '5000' };
    const res = await signCommand('cmd-1', { pool: fakePool({ calls, row }), keyProvider });
    expect(res).toEqual({ ok: false, reason: 'secondApprovalRequired' });
    expect(calls.some((c) => /UPDATE money_commands\s+SET signature/i.test(c.sql))).toBe(false);
    expect(calls.some((c) => /ROLLBACK/i.test(c.sql))).toBe(true);
  });

  it('Р-456 C: admin draft ПРИ bootstrap → signed + запись bootstrap_self_approval + алерт', async () => {
    const calls: Call[] = [];
    const alertAllAdmins = vi.fn(async (_alert: MoneyAlert) => {});
    const row: FakeRow = {
      ...ROW,
      state: 'draft',
      amount_minor: '5000',
      initiator_role: 'admin',
      bootstrap_mode: true,
    };
    const res = await signCommand('cmd-1', {
      pool: fakePool({ calls, row }),
      keyProvider,
      adminAlert: { alertAllAdmins },
    });
    expect(res).toEqual({ ok: true, state: 'signed' });
    const actions = calls
      .filter((c) => /INSERT INTO admin_action_journal/i.test(c.sql))
      .map((c) => c.params[2]);
    expect(actions).toContain('money.command.signed');
    expect(actions).toContain('money.command.bootstrap_self_approval');
    expect(alertAllAdmins).toHaveBeenCalledTimes(1);
    expect(alertAllAdmins.mock.calls[0]![0]).toMatchObject({ kind: 'bootstrap_self_approval' });
  });

  it('Р-456 C: admin draft ВЫШЕ порога БЕЗ bootstrap → secondApprovalRequired (освобождение снято)', async () => {
    const calls: Call[] = [];
    const row: FakeRow = {
      ...ROW,
      state: 'draft',
      amount_minor: '5000',
      initiator_role: 'admin',
      bootstrap_mode: false,
    };
    const res = await signCommand('cmd-1', { pool: fakePool({ calls, row }), keyProvider });
    expect(res).toEqual({ ok: false, reason: 'secondApprovalRequired' });
    expect(calls.some((c) => /UPDATE money_commands\s+SET signature/i.test(c.sql))).toBe(false);
  });
});

describe('reviewBreakGlass', () => {
  it('ревью break-glass команды → ok, журнал break_glass_reviewed', async () => {
    const calls: Call[] = [];
    const pool = fakePool({ calls, row: { ...ROW, break_glass: true } });
    const res = await reviewBreakGlass('cmd-1', 'op-admin', 'инцидент подтверждён, действия верны', {
      pool,
    });
    expect(res).toEqual({ ok: true });
    expect(
      calls.filter((c) => /INSERT INTO admin_action_journal/i.test(c.sql)).map((c) => c.params[2]),
    ).toContain('money.command.break_glass_reviewed');
  });

  it('пустой результат → missingResult', async () => {
    const res = await reviewBreakGlass('cmd-1', 'op-admin', '  ', { pool: fakePool({ calls: [] }) });
    expect(res).toEqual({ ok: false, reason: 'missingResult' });
  });
});
