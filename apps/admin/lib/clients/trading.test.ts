import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({
  getPool: () => {
    throw new Error('пул не должен трогаться — тест подаёт фейк');
  },
}));

import { formatMoneyCents, formatPnlCents, getClientTrading } from './trading';

/**
 * «Счёт и торговля» в карточке: чтение проекции торговли (demo_accounts /
 * demo_positions / demo_trades). Проверяем сборку модели из строк, честный
 * «счёт не открыт» и выбор последней активности.
 */

function fakeDb(tables: {
  account?: Record<string, unknown> | null;
  positions?: Record<string, unknown>[];
  trades?: Record<string, unknown>[];
  totals?: Record<string, unknown>;
}) {
  return {
    async query(sql: string) {
      if (/FROM demo_accounts/.test(sql)) return { rows: tables.account ? [tables.account] : [] };
      if (/count\(\*\) AS trades_total/.test(sql)) return { rows: [tables.totals ?? {}] };
      if (/FROM demo_positions WHERE user_id = \$1\s+ORDER/.test(sql)) return { rows: tables.positions ?? [] };
      if (/FROM demo_trades WHERE user_id = \$1\s+ORDER/.test(sql)) return { rows: tables.trades ?? [] };
      throw new Error(`unexpected sql: ${sql}`);
    },
  };
}

describe('getClientTrading', () => {
  it('собирает баланс, позиции, сделки и итоги из проекции', async () => {
    const t = await getClientTrading(
      'u1',
      fakeDb({
        account: { balance_cents: '1234567', currency: 'USD', created_at: '2026-11-01T10:00:00Z' },
        positions: [
          { id: 'p1', symbol: 'EURUSD', side: 'buy', volume: '0.5', entry_price: '1.0812', updated_at: '2026-11-08T09:00:00Z' },
        ],
        trades: [
          { id: 't2', trade_id: 'T-2', symbol: 'EURUSD', side: 'sell', volume: '0.5', price: '1.09', realized_pnl_cents: '-350', executed_at: '2026-11-08T12:00:00Z' },
          { id: 't1', trade_id: 'T-1', symbol: 'EURUSD', side: 'buy', volume: '0.5', price: '1.08', realized_pnl_cents: null, executed_at: '2026-11-07T12:00:00Z' },
        ],
        totals: {
          trades_total: '2',
          pnl_total: '-350',
          last_trade_at: '2026-11-08T12:00:00Z',
          last_position_at: '2026-11-08T09:00:00Z',
        },
      }),
    );

    expect(t.account).toEqual({ balanceCents: 1234567, currency: 'USD', openedAt: '2026-11-01T10:00:00.000Z' });
    expect(t.positions[0]).toMatchObject({ symbol: 'EURUSD', side: 'buy', volume: 0.5, entryPrice: 1.0812 });
    expect(t.recentTrades.map((r) => r.realizedPnlCents)).toEqual([-350, null]);
    expect(t.tradesTotal).toBe(2);
    expect(t.realizedPnlTotalCents).toBe(-350);
    expect(t.lastActivityAt).toBe('2026-11-08T12:00:00.000Z');
  });

  it('счёт не открыт и не торговал → account null, активность null (без выдуманных нулей)', async () => {
    const t = await getClientTrading('u1', fakeDb({ totals: { trades_total: '0', pnl_total: '0' } }));

    expect(t.account).toBeNull();
    expect(t.positions).toEqual([]);
    expect(t.recentTrades).toEqual([]);
    expect(t.lastActivityAt).toBeNull();
  });

  it('последняя активность — свежайшее из сделки и снимка позиций', async () => {
    const t = await getClientTrading(
      'u1',
      fakeDb({
        totals: {
          trades_total: '1',
          pnl_total: '0',
          last_trade_at: '2026-11-01T00:00:00Z',
          last_position_at: '2026-11-05T00:00:00Z',
        },
      }),
    );
    expect(t.lastActivityAt).toBe('2026-11-05T00:00:00.000Z');
  });
});

describe('форматирование денег', () => {
  it('минорные единицы → валюта; P&L со знаком', () => {
    expect(formatMoneyCents(1234567, 'USD')).toMatch(/12\s?345,67/);
    expect(formatPnlCents(1200, 'USD').startsWith('+')).toBe(true);
    expect(formatPnlCents(-350, 'USD').startsWith('−')).toBe(true);
    expect(formatPnlCents(0, 'USD').startsWith('+')).toBe(false);
  });

  it('незнакомая валюта не роняет показ', () => {
    expect(formatMoneyCents(100, 'NOT_A_CODE')).toBe('1.00 NOT_A_CODE');
  });
});
