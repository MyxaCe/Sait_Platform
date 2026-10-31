import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateTotp, generateTotpSecret } from './totp';

/**
 * ADM-13 · операции второго фактора над `operators` (Р-454 III-3, Р-451).
 *
 * База и журнал замоканы; TOTP-крипто настоящее. Проверяется второй шаг входа
 * (верный/неверный код, отключённый, без секрета), статус включённости и
 * сохранение секрета с записью в журнал одной транзакцией.
 */

const ID = '33333333-3333-3333-3333-333333333333';

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
  appendJournalEntry.mockClear();
  fakeClient.query.mockClear();
  fakeClient.release.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
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

    // Код на 10 шагов вперёд — вне окна ±1.
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
    expect(update!.params).toEqual([secret, ID]);

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
