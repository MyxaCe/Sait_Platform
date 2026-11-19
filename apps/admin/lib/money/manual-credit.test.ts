import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@broker/money';
import { FakeTerminal } from '@broker/money/testing';
import { createTestDb, seedOperator, seedUser, type TestDb } from '@broker/support/testing';
import type { AdminAlertPort } from './alerts';
import {
  approveManualCredit,
  declineManualCredit,
  initiateManualCredit,
  manualCreditRef,
  retryManualCredit,
  type CreditActor,
  type ManualCreditDeps,
} from './manual-credit';
import { listManualCredits } from './credit-queries';
import { generateEd25519KeyPair, StaticEd25519KeyProvider } from './signing';

const { privateKey, publicKey } = generateEd25519KeyPair();
const keyProvider = new StaticEd25519KeyProvider(privateKey, publicKey, 'v1');

let db: TestDb;
let term: FakeTerminal;
let alerts: AdminAlertPort & { alertAllAdmins: ReturnType<typeof vi.fn> };
let client: string;
let admin: CreditActor;
let admin2: CreditActor;
let fin: CreditActor;

function deps(extra: Partial<ManualCreditDeps> = {}): ManualCreditDeps {
  return { pool: db as never, terminal: term, keyProvider, adminAlert: alerts, ...extra };
}

async function actor(role: 'admin' | 'finance_operator' | 'operator' | 'support_operator', login: string): Promise<CreditActor> {
  return { operatorId: await seedOperator(db, role, login), role, login };
}

async function command(id: string) {
  const r = await db.query(`SELECT * FROM money_commands WHERE id = $1`, [id]);
  return r.rows[0] as Record<string, unknown>;
}

async function journal(id: string): Promise<string[]> {
  const r = await db.query(
    `SELECT action FROM admin_action_journal WHERE subject_kind = 'money_command' AND subject_id = $1 ORDER BY seq`,
    [id],
  );
  return r.rows.map((x) => String(x.action));
}

const credit = (who: CreditActor, amountMinor = 25_000, basis = 'клиент оплатил банковским переводом, платёжка №17') =>
  initiateManualCredit({ actor: who, userId: client, amountMinor, basis }, deps());

beforeEach(async () => {
  db = await createTestDb();
  term = new FakeTerminal();
  alerts = { alertAllAdmins: vi.fn(async () => {}) };
  client = await seedUser(db);
  admin = await actor('admin', 'boss');
  admin2 = await actor('admin', 'boss2');
  fin = await actor('finance_operator', 'fin');
});

afterEach(async () => {
  delete process.env.MONEY_BOOTSTRAP_MODE;
  delete process.env.MONEY_DUAL_CONTROL_THRESHOLD_MINOR;
  await db.close();
});

describe('bootstrap: admin подтверждает сам и деньги уходят в терминал', () => {
  beforeEach(() => {
    process.env.MONEY_BOOTSTRAP_MODE = 'true';
  });

  it('инициация → самоподтверждение (журнал + алерт) → зачисление на реальный счёт', async () => {
    const r = await credit(admin);
    expect(r).toMatchObject({ ok: true, state: 'executed', replay: false });
    if (!r.ok) throw new Error();
    expect(term.balances.get(client)).toBe(25_000);
    expect(term.calls).toEqual([{ op: 'deposit', userId: client, ref: manualCreditRef(r.commandId), amount: 25_000 }]);
    expect(routes.deposit('site', client)).toContain('/real/deposit');

    const row = await command(r.commandId);
    expect(row).toMatchObject({ state: 'executed', type: 'credit', currency: 'USDT', bootstrap_mode: true, dispatch_attempts: 1 });
    expect(row.signature).toBeTruthy();
    expect(Number(row.terminal_seq)).toBeGreaterThan(0);
    expect(await journal(r.commandId)).toEqual([
      'money.command.initiated',
      'money.command.signed',
      'money.command.bootstrap_self_approval',
      'money.command.executed',
    ]);
    expect(alerts.alertAllAdmins).toHaveBeenCalledWith(expect.objectContaining({ kind: 'bootstrap_self_approval', commandId: r.commandId }));
  });

  it('терминал не ответил → команда «dispatched», повтор с тем же ключом не зачисляет дважды', async () => {
    term.next = ['apply-then-unavailable'];
    const r = await credit(admin);
    expect(r).toMatchObject({ ok: false, reason: 'terminalUnavailable' });
    const id = r.commandId!;
    expect(await command(id)).toMatchObject({ state: 'dispatched', result_code: 'unavailable', dispatch_attempts: 1 });

    const again = await retryManualCredit({ actor: fin, commandId: id, note: 'терминал снова доступен' }, deps());
    expect(again).toMatchObject({ ok: true, state: 'executed', replay: true });
    expect(term.balances.get(client)).toBe(25_000);
    expect(term.calls.filter((c) => c.op === 'deposit').map((c) => c.ref)).toEqual([manualCreditRef(id), manualCreditRef(id)]);
    expect(await command(id)).toMatchObject({ state: 'executed', dispatch_attempts: 2, result_code: null });

    const third = await retryManualCredit({ actor: admin, commandId: id, note: 'двойной клик' }, deps());
    expect(third).toMatchObject({ ok: false, reason: 'illegalState' });
    expect(term.calls.filter((c) => c.op === 'deposit')).toHaveLength(2);
    expect(await journal(id)).toContain('money.command.terminal_unavailable');
  });

  it('терминал отказал → «rejected» с кодом, повтор запрещён, денег нет', async () => {
    term.next = ['account_quarantined'];
    const r = await credit(admin);
    expect(r).toMatchObject({ ok: false, reason: 'terminalRefused', code: 'account_quarantined' });
    const id = r.commandId!;
    expect(await command(id)).toMatchObject({ state: 'rejected', result_code: 'account_quarantined' });
    expect(term.balances.get(client)).toBeUndefined();
    expect(await journal(id)).toContain('money.command.terminal_refused');
    expect(await retryManualCredit({ actor: admin, commandId: id, note: 'ещё раз' }, deps())).toMatchObject({
      ok: false,
      reason: 'illegalState',
    });
  });
});

describe('dual control: второе подтверждение', () => {
  it('admin без bootstrap → ждёт второго; сам себя не подтверждает; другой подтверждает → зачислено', async () => {
    const r = await credit(admin);
    expect(r).toMatchObject({ ok: true, state: 'awaiting_second_approval' });
    const id = r.commandId!;
    expect(term.calls).toEqual([]);

    expect(await approveManualCredit({ actor: admin, commandId: id, note: 'сам' }, deps())).toMatchObject({
      ok: false,
      reason: 'selfApprovalForbidden',
    });
    expect(term.calls).toEqual([]);

    const ok = await approveManualCredit({ actor: fin, commandId: id, note: 'платёжка сверена' }, deps());
    expect(ok).toMatchObject({ ok: true, state: 'executed' });
    expect(term.balances.get(client)).toBe(25_000);
    expect(await journal(id)).toEqual(['money.command.initiated', 'money.command.second_approved', 'money.command.executed']);
    const approvals = await db.query(`SELECT kind, approver_id FROM money_command_approvals WHERE command_id = $1 ORDER BY kind`, [id]);
    expect(approvals.rows).toEqual([
      { kind: 'initiate', approver_id: admin.operatorId },
      { kind: 'second_approval', approver_id: fin.operatorId },
    ]);
    const [row] = await listManualCredits({ userId: client }, db);
    expect(row).toMatchObject({ state: 'executed', approverName: expect.any(String), amountMinor: 25_000 });

    expect(await approveManualCredit({ actor: admin2, commandId: id, note: 'ещё раз' }, deps())).toMatchObject({
      ok: false,
      reason: 'illegalState',
    });
    expect(term.balances.get(client)).toBe(25_000);
  });

  it('finance_operator выше порога → ждёт; отклонение другим — деньги не двигаются, подтвердить уже нельзя', async () => {
    process.env.MONEY_BOOTSTRAP_MODE = 'true';
    process.env.MONEY_DUAL_CONTROL_THRESHOLD_MINOR = '10000';
    const r = await credit(fin);
    expect(r).toMatchObject({ ok: true, state: 'awaiting_second_approval' });
    const id = r.commandId!;
    expect(await declineManualCredit({ actor: admin, commandId: id, reason: 'платёжка не найдена' }, deps())).toEqual({ ok: true });
    expect(await command(id)).toMatchObject({ state: 'rejected', result_code: 'declined', decided_by: admin.operatorId });
    expect(await journal(id)).toEqual(['money.command.initiated', 'money.command.declined']);
    expect(await approveManualCredit({ actor: admin, commandId: id, note: 'передумал' }, deps())).toMatchObject({
      ok: false,
      reason: 'illegalState',
    });
    expect(term.calls).toEqual([]);
  });

  it('finance_operator в пределах порога → без второго подтверждения', async () => {
    process.env.MONEY_DUAL_CONTROL_THRESHOLD_MINOR = '100000';
    const r = await credit(fin, 5_000);
    expect(r).toMatchObject({ ok: true, state: 'executed' });
    expect(await journal(r.commandId!)).toEqual(['money.command.initiated', 'money.command.signed', 'money.command.executed']);
  });
});

describe('права и проверки до создания команды', () => {
  beforeEach(() => {
    process.env.MONEY_BOOTSTRAP_MODE = 'true';
  });

  it('operator и support_operator — отказ, ничего не создаётся и в терминал не уходит', async () => {
    for (const role of ['operator', 'support_operator'] as const) {
      const who = await actor(role, `${role}-x`);
      expect(await credit(who)).toEqual({ ok: false, reason: 'forbidden' });
      expect(await approveManualCredit({ actor: who, commandId: crypto.randomUUID(), note: 'x' }, deps())).toEqual({
        ok: false,
        reason: 'forbidden',
      });
      expect(await retryManualCredit({ actor: who, commandId: crypto.randomUUID(), note: 'x' }, deps())).toEqual({
        ok: false,
        reason: 'forbidden',
      });
      expect(await declineManualCredit({ actor: who, commandId: crypto.randomUUID(), reason: 'x' }, deps())).toEqual({
        ok: false,
        reason: 'forbidden',
      });
    }
    expect((await db.query(`SELECT count(*)::int AS n FROM money_commands`)).rows[0]!.n).toBe(0);
    expect(term.calls).toEqual([]);
  });

  it('без основания, с плохой суммой, без клиента, без ключа подписи — отказ без команды', async () => {
    expect(await credit(admin, 25_000, '   ')).toEqual({ ok: false, reason: 'missingBasis' });
    expect(await credit(admin, 0)).toEqual({ ok: false, reason: 'invalidAmount' });
    expect(await credit(admin, 1.5)).toEqual({ ok: false, reason: 'invalidAmount' });
    expect(
      await initiateManualCredit({ actor: admin, userId: crypto.randomUUID(), amountMinor: 100, basis: 'x' }, deps()),
    ).toEqual({ ok: false, reason: 'noClient' });
    expect(await initiateManualCredit({ actor: admin, userId: 'not-a-uuid', amountMinor: 100, basis: 'x' }, deps())).toEqual({
      ok: false,
      reason: 'noClient',
    });
    const saved = process.env.MONEY_SIGNING_KEY_PEM_B64;
    delete process.env.MONEY_SIGNING_KEY_PEM_B64;
    expect(
      await initiateManualCredit(
        { actor: admin, userId: client, amountMinor: 100, basis: 'x' },
        { pool: db as never, terminal: term },
      ),
    ).toEqual({ ok: false, reason: 'signingKeyMissing' });
    if (saved !== undefined) process.env.MONEY_SIGNING_KEY_PEM_B64 = saved;
    expect((await db.query(`SELECT count(*)::int AS n FROM money_commands`)).rows[0]!.n).toBe(0);
    expect(term.calls).toEqual([]);
  });
});
