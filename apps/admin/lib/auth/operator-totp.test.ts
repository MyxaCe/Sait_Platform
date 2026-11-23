import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptTotpSecret, encryptTotpSecret, twoFactorKey } from '@broker/support';
import { generateTotp, generateTotpSecret } from './totp';

const ID = '33333333-3333-3333-3333-333333333333';
const RAW_KEY = 'k'.repeat(48);
const KEY = twoFactorKey(RAW_KEY)!;
const OTHER_KEY = twoFactorKey('z'.repeat(48))!;
const UPGRADE = /UPDATE operators SET totp_secret/i;

const poolQueries: { sql: string; params: unknown[] }[] = [];
const clientQueries: { sql: string; params: unknown[] }[] = [];
let operatorRow: Record<string, unknown> | undefined;
let updateRows: Record<string, unknown>[] = [{ id: ID }];

const fakeClient = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    clientQueries.push({ sql, params });
    if (/UPDATE operators/i.test(sql)) return { rows: updateRows };
    return { rows: [] };
  }),
  release: vi.fn(),
};

vi.mock('./../db', () => ({
  getPool: () => ({
    query: async (sql: string, params: unknown[] = []) => {
      poolQueries.push({ sql, params });
      if (/FROM operators WHERE id/i.test(sql)) {
        return { rows: operatorRow ? [operatorRow] : [] };
      }
      if (UPGRADE.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [] };
    },
    connect: async () => fakeClient,
  }),
}));

const appendJournalEntry = vi.fn(async (..._args: unknown[]) => ({}));
vi.mock('./../journal/journal', () => ({
  appendJournalEntry: (...args: unknown[]) => appendJournalEntry(...args),
}));

function makeRow(secret: string | null, over: Record<string, unknown> = {}) {
  return {
    id: ID,
    login: 'super',
    display_name: 'Главный оператор',
    role: 'admin',
    totp_secret: secret,
    disabled_at: null,
    ...over,
  };
}

beforeEach(() => {
  poolQueries.length = 0;
  clientQueries.length = 0;
  operatorRow = undefined;
  updateRows = [{ id: ID }];
  vi.stubEnv('ADMIN_TOTP_KEY', RAW_KEY);
  vi.stubEnv('ADMIN_TOTP_REQUIRE_ENCRYPTED', '0');
  appendJournalEntry.mockClear();
  fakeClient.query.mockClear();
  fakeClient.release.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('verifyOperatorTotpStep · второй шаг входа', () => {
  it('верный код живого оператора → сессия', async () => {
    const secret = generateTotpSecret();
    operatorRow = makeRow(secret);
    const { verifyOperatorTotpStep } = await import('./operator-totp');

    const result = await verifyOperatorTotpStep(ID, generateTotp(secret));
    expect(result).toEqual({
      ok: true,
      session: { operatorId: ID, login: 'super', displayName: 'Главный оператор', role: 'admin' },
    });
  });

  it('неверный код → общий отказ', async () => {
    const secret = generateTotpSecret();
    operatorRow = makeRow(secret);
    const { verifyOperatorTotpStep } = await import('./operator-totp');

    const wrong = generateTotp(secret, {}, Date.now() + 10 * 30_000);
    expect(await verifyOperatorTotpStep(ID, wrong)).toEqual({ ok: false });
  });

  it('отключённый оператор с ВЕРНЫМ кодом → отказ', async () => {
    const secret = generateTotpSecret();
    operatorRow = makeRow(secret, { disabled_at: new Date('2026-01-01') });
    const { verifyOperatorTotpStep } = await import('./operator-totp');

    expect(await verifyOperatorTotpStep(ID, generateTotp(secret))).toEqual({ ok: false });
  });

  it('секрет не задан (пришли на шаг TOTP зря) → отказ', async () => {
    operatorRow = makeRow(null);
    const { verifyOperatorTotpStep } = await import('./operator-totp');

    expect(await verifyOperatorTotpStep(ID, '000000')).toEqual({ ok: false });
  });

  it('нет такого оператора → отказ', async () => {
    operatorRow = undefined;
    const { verifyOperatorTotpStep } = await import('./operator-totp');

    expect(await verifyOperatorTotpStep(ID, '000000')).toEqual({ ok: false });
  });
});

describe('isOperatorEnrolled', () => {
  it('секрет задан → true', async () => {
    operatorRow = makeRow(generateTotpSecret());
    const { isOperatorEnrolled } = await import('./operator-totp');
    expect(await isOperatorEnrolled(ID)).toBe(true);
  });

  it('секрет NULL → false (суперадмин без 2FA)', async () => {
    operatorRow = makeRow(null);
    const { isOperatorEnrolled } = await import('./operator-totp');
    expect(await isOperatorEnrolled(ID)).toBe(false);
  });

  it('нет оператора → false', async () => {
    operatorRow = undefined;
    const { isOperatorEnrolled } = await import('./operator-totp');
    expect(await isOperatorEnrolled(ID)).toBe(false);
  });
});

describe('saveOperatorTotpSecret · регистрация', () => {
  it('пишет секрет и журналирует operator.totp_enrolled одной транзакцией', async () => {
    const secret = generateTotpSecret();
    const { saveOperatorTotpSecret } = await import('./operator-totp');

    await saveOperatorTotpSecret(ID, 'super', secret);

    const update = clientQueries.find((c) => /UPDATE operators/i.test(c.sql));
    expect(update, 'должен быть UPDATE operators').toBeTruthy();
    expect(update!.sql).toMatch(/totp_secret/i);
    expect(update!.sql).toMatch(/totp_enrolled_at\s*=\s*now\(\)/i);
    const [stored, id] = update!.params as [string, string];
    expect(id).toBe(ID);
    expect(stored.startsWith('v1.'), 'секрет пишется зашифрованным').toBe(true);
    expect(stored).not.toContain(secret);
    expect(decryptTotpSecret(stored, KEY)).toBe(secret);

    expect(appendJournalEntry).toHaveBeenCalledTimes(1);
    const entry = appendJournalEntry.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(entry.action).toBe('operator.totp_enrolled');
    expect(entry.subjectId).toBe(ID);

    const ops = clientQueries.map((c) => c.sql);
    expect(ops.some((s) => /BEGIN/i.test(s))).toBe(true);
    expect(ops.some((s) => /COMMIT/i.test(s))).toBe(true);
    expect(fakeClient.release).toHaveBeenCalled();
  });

  it('оператор не найден/отключён (0 строк UPDATE) → откат и ошибка, журнала нет', async () => {
    updateRows = [];
    const { saveOperatorTotpSecret } = await import('./operator-totp');

    await expect(saveOperatorTotpSecret(ID, 'super', generateTotpSecret())).rejects.toThrow();
    expect(appendJournalEntry).not.toHaveBeenCalled();
    expect(clientQueries.some((c) => /ROLLBACK/i.test(c.sql))).toBe(true);
  });
});

describe('ТД-013 · шифрование секрета оператора', () => {
  it('зашифрованный секрет + верный код → сессия, перезаписи нет', async () => {
    const secret = generateTotpSecret();
    operatorRow = makeRow(encryptTotpSecret(secret, KEY));
    const { verifyOperatorTotpStep } = await import('./operator-totp');

    expect((await verifyOperatorTotpStep(ID, generateTotp(secret))).ok).toBe(true);
    expect(poolQueries.some((q) => UPGRADE.test(q.sql))).toBe(false);
  });

  it('открытый (старый) секрет + верный код → вход и перешифровка со сравнением старого значения', async () => {
    const secret = generateTotpSecret();
    operatorRow = makeRow(secret);
    const { verifyOperatorTotpStep } = await import('./operator-totp');

    expect((await verifyOperatorTotpStep(ID, generateTotp(secret))).ok).toBe(true);
    const upgrade = poolQueries.find((q) => UPGRADE.test(q.sql));
    expect(upgrade, 'должна быть перешифровка').toBeTruthy();
    expect(upgrade!.sql).toMatch(/AND totp_secret = \$3/);
    const [sealed, id, legacy] = upgrade!.params as [string, string, string];
    expect(id).toBe(ID);
    expect(legacy).toBe(secret);
    expect(decryptTotpSecret(sealed, KEY)).toBe(secret);
  });

  it('открытый секрет + НЕВЕРНЫЙ код → отказ и без перешифровки', async () => {
    const secret = generateTotpSecret();
    operatorRow = makeRow(secret);
    const { verifyOperatorTotpStep } = await import('./operator-totp');

    const wrong = generateTotp(secret, {}, Date.now() + 10 * 30_000);
    expect(await verifyOperatorTotpStep(ID, wrong)).toEqual({ ok: false });
    expect(poolQueries.some((q) => UPGRADE.test(q.sql))).toBe(false);
  });

  it('секрет зашифрован другим ключом → отказ даже с верным кодом', async () => {
    const secret = generateTotpSecret();
    operatorRow = makeRow(encryptTotpSecret(secret, OTHER_KEY));
    const { verifyOperatorTotpStep } = await import('./operator-totp');

    expect(await verifyOperatorTotpStep(ID, generateTotp(secret))).toEqual({ ok: false });
  });

  it('ADMIN_TOTP_REQUIRE_ENCRYPTED=1 → вход по открытому секрету запрещён', async () => {
    vi.stubEnv('ADMIN_TOTP_REQUIRE_ENCRYPTED', '1');
    const secret = generateTotpSecret();
    operatorRow = makeRow(secret);
    const { verifyOperatorTotpStep } = await import('./operator-totp');

    expect(await verifyOperatorTotpStep(ID, generateTotp(secret))).toEqual({ ok: false });
  });

  it('ключа нет: вход по открытому секрету работает, без перешифровки', async () => {
    vi.stubEnv('ADMIN_TOTP_KEY', '');
    const secret = generateTotpSecret();
    operatorRow = makeRow(secret);
    const { verifyOperatorTotpStep } = await import('./operator-totp');

    expect((await verifyOperatorTotpStep(ID, generateTotp(secret))).ok).toBe(true);
    expect(poolQueries.some((q) => UPGRADE.test(q.sql))).toBe(false);
  });

  it('ключа нет: зашифрованный секрет не открыть → отказ', async () => {
    const secret = generateTotpSecret();
    operatorRow = makeRow(encryptTotpSecret(secret, KEY));
    vi.stubEnv('ADMIN_TOTP_KEY', '');
    const { verifyOperatorTotpStep } = await import('./operator-totp');

    expect(await verifyOperatorTotpStep(ID, generateTotp(secret))).toEqual({ ok: false });
  });

  it('ключа нет: подключение 2FA отклоняется до транзакции, в базу ничего', async () => {
    vi.stubEnv('ADMIN_TOTP_KEY', 'short');
    const { saveOperatorTotpSecret, OperatorTotpKeyMissingError, canEnrollOperatorTotp } = await import(
      './operator-totp'
    );

    expect(canEnrollOperatorTotp()).toBe(false);
    await expect(saveOperatorTotpSecret(ID, 'super', generateTotpSecret())).rejects.toBeInstanceOf(
      OperatorTotpKeyMissingError,
    );
    expect(clientQueries).toHaveLength(0);
    expect(appendJournalEntry).not.toHaveBeenCalled();
  });
});
