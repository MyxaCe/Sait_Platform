import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { changePortfolioLeverage, setClassOverride } from './portfolio';

/**
 * WEB-47/45 · смена плеча портфеля глобально и планка класса (Р-446, Р-049).
 *
 * База не поднимается — in-memory фейк ведёт себя как `leverage_portfolios` +
 * `leverage_portfolio_class_overrides` + `admin_action_journal` в одной
 * транзакции. Проверяем содержательный переход, журнал с diff/основанием и
 * fail-closed без основания.
 */

const OP = '11111111-1111-1111-1111-111111111111';

interface JournalRow {
  seq: number;
  action: string;
  subject_kind: string;
  subject_id: string;
  payload: string;
  entry_hash: string;
}

function fakePool(opts: { base?: number | null; classLeverage?: number | null; portfolioExists?: boolean }) {
  const portfolioExists = opts.portfolioExists ?? true;
  const state = { base: opts.base ?? 20, classLeverage: opts.classLeverage ?? null as number | null };
  const journal: JournalRow[] = [];
  const flags = { begun: false, committed: false, rolledBack: false };

  const client = {
    async query(sql: string, params: unknown[] = []) {
      if (/^BEGIN/i.test(sql)) return (flags.begun = true), { rows: [] };
      if (/^ROLLBACK/i.test(sql)) return (flags.rolledBack = true), { rows: [] };
      if (/^COMMIT/i.test(sql)) return (flags.committed = true), { rows: [] };
      if (/SELECT base_leverage FROM leverage_portfolios WHERE key/i.test(sql)) {
        return { rows: portfolioExists ? [{ base_leverage: state.base }] : [] };
      }
      if (/SELECT 1 FROM leverage_portfolios WHERE key/i.test(sql)) {
        return { rows: portfolioExists ? [{ '?column?': 1 }] : [] };
      }
      if (/UPDATE leverage_portfolios SET base_leverage/i.test(sql)) {
        state.base = params[1] as number;
        return { rows: [] };
      }
      if (/SELECT leverage FROM leverage_portfolio_class_overrides/i.test(sql)) {
        return { rows: state.classLeverage === null ? [] : [{ leverage: state.classLeverage }] };
      }
      if (/INSERT INTO leverage_portfolio_class_overrides/i.test(sql)) {
        state.classLeverage = params[2] as number;
        return { rows: [] };
      }
      if (/DELETE FROM leverage_portfolio_class_overrides/i.test(sql)) {
        state.classLeverage = null;
        return { rows: [] };
      }
      if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [{ pg_advisory_xact_lock: '' }] };
      if (/SELECT entry_hash FROM admin_action_journal/i.test(sql)) {
        const last = journal[journal.length - 1];
        return { rows: last ? [{ entry_hash: last.entry_hash }] : [] };
      }
      if (/INSERT INTO admin_action_journal/i.test(sql)) {
        const p = params as string[];
        journal.push({
          seq: journal.length + 1,
          action: p[2]!,
          subject_kind: p[3]!,
          subject_id: p[4]!,
          payload: p[5]!,
          entry_hash: p[7]!,
        });
        return { rows: [] };
      }
      if (/SELECT seq FROM admin_action_journal WHERE entry_hash/i.test(sql)) {
        const found = journal.find((r) => r.entry_hash === params[0]);
        return { rows: found ? [{ seq: found.seq }] : [] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
    release() {},
  };
  const pool = { async connect() { return client as unknown as PoolClient; } };
  return { pool, state, journal, flags };
}

describe('WEB-47 · смена плеча портфеля глобально', () => {
  it('меняет базу, пишет leverage.portfolio_changed с diff и основанием', async () => {
    const f = fakePool({ base: 20 });
    const res = await changePortfolioLeverage(
      { operatorId: OP, portfolioKey: 'standard', baseLeverage: 25, reason: 'показ владельцу' },
      f.pool,
    );
    expect(res).toMatchObject({ ok: true });
    expect(f.state.base).toBe(25);
    expect(f.journal).toHaveLength(1);
    expect(f.journal[0]!.action).toBe('leverage.portfolio_changed');
    expect(f.journal[0]!.subject_kind).toBe('leverage_portfolio');
    const payload = JSON.parse(f.journal[0]!.payload);
    expect(payload).toMatchObject({ basis: 'показ владельцу', previousBase: 20, newBase: 25 });
    expect(f.flags.committed).toBe(true);
  });

  it('без основания — fail-closed, транзакции нет', async () => {
    const f = fakePool({ base: 20 });
    const res = await changePortfolioLeverage(
      { operatorId: OP, portfolioKey: 'standard', baseLeverage: 25, reason: '  ' },
      f.pool,
    );
    expect(res).toEqual({ ok: false, reason: 'missingReason' });
    expect(f.flags.begun).toBe(false);
    expect(f.journal).toHaveLength(0);
  });

  it('плечо < 1 — invalidLeverage, ничего не пишем', async () => {
    const f = fakePool({ base: 20 });
    const res = await changePortfolioLeverage(
      { operatorId: OP, portfolioKey: 'standard', baseLeverage: 0, reason: 'нельзя' },
      f.pool,
    );
    expect(res).toEqual({ ok: false, reason: 'invalidLeverage' });
    expect(f.journal).toHaveLength(0);
  });

  it('то же плечо — пустой переход, откат', async () => {
    const f = fakePool({ base: 20 });
    const res = await changePortfolioLeverage(
      { operatorId: OP, portfolioKey: 'standard', baseLeverage: 20, reason: 'без изменений' },
      f.pool,
    );
    expect(res).toEqual({ ok: false, reason: 'alreadyInState' });
    expect(f.flags.rolledBack).toBe(true);
  });

  it('нет такого портфеля — noPortfolio', async () => {
    const f = fakePool({ portfolioExists: false });
    const res = await changePortfolioLeverage(
      { operatorId: OP, portfolioKey: 'нет', baseLeverage: 30, reason: 'есть основание' },
      f.pool,
    );
    expect(res).toEqual({ ok: false, reason: 'noPortfolio' });
  });
});

describe('WEB-45 · планка класса внутри портфеля', () => {
  it('задать крипто-планку: INSERT + leverage.class_override_set с diff', async () => {
    const f = fakePool({ classLeverage: null });
    const res = await setClassOverride(
      { operatorId: OP, portfolioKey: 'standard', instrumentClass: 'crypto', leverage: 10, reason: 'боевая планка' },
      f.pool,
    );
    expect(res).toMatchObject({ ok: true });
    expect(f.state.classLeverage).toBe(10);
    expect(f.journal[0]!.action).toBe('leverage.class_override_set');
    const payload = JSON.parse(f.journal[0]!.payload);
    expect(payload).toMatchObject({ instrumentClass: 'crypto', previousLeverage: null, newLeverage: 10 });
  });

  it('снять планку (leverage=null): DELETE + leverage.class_override_cleared', async () => {
    const f = fakePool({ classLeverage: 10 });
    const res = await setClassOverride(
      { operatorId: OP, portfolioKey: 'standard', instrumentClass: 'crypto', leverage: null, reason: 'убрать' },
      f.pool,
    );
    expect(res).toMatchObject({ ok: true });
    expect(f.state.classLeverage).toBeNull();
    expect(f.journal[0]!.action).toBe('leverage.class_override_cleared');
    expect(JSON.parse(f.journal[0]!.payload).previousLeverage).toBe(10);
  });

  it('та же планка — пустой переход, откат', async () => {
    const f = fakePool({ classLeverage: 10 });
    const res = await setClassOverride(
      { operatorId: OP, portfolioKey: 'standard', instrumentClass: 'crypto', leverage: 10, reason: 'то же' },
      f.pool,
    );
    expect(res).toEqual({ ok: false, reason: 'alreadyInState' });
    expect(f.flags.rolledBack).toBe(true);
  });
});
