import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { WithdrawalRowView } from '@/lib/crypto/queries';
import { awaitingSend, requestsWord } from './view';

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
// Формы решения (server actions) в этом тесте не нужны.
vi.mock('./MoneyForms', () => ({ WithdrawalActions: () => null }));

const { AwaitingSendBanner } = await import('./WithdrawalsView');

function w(p: Partial<WithdrawalRowView>): WithdrawalRowView {
  return {
    id: 'w',
    userId: 'u',
    clientName: 'Клиент',
    clientEmail: 'c@x',
    toAddress: 'T',
    amountMinor: 0,
    status: 'requested',
    debitState: 'done',
    rejectReason: null,
    reviewReason: null,
    checkNote: null,
    payoutTxHash: null,
    refunded: false,
    requestedAt: '2026-11-10T08:00:00Z',
    ...p,
  };
}

const rows = [
  w({ id: 'a', status: 'approved', amountMinor: 150_00, requestedAt: '2026-11-10T09:00:00Z' }),
  w({ id: 'b', status: 'approved', amountMinor: 25_50, requestedAt: '2026-11-09T09:00:00Z' }),
  w({ id: 'c', status: 'approved', amountMinor: 999_00, payoutTxHash: 'f'.repeat(64) }),
  w({ id: 'd', status: 'sent', amountMinor: 1_00 }),
  w({ id: 'e', status: 'requested', amountMinor: 5_00 }),
];

describe('«Ждут вашей отправки» над очередью выводов', () => {
  it('считает только одобренные без хэша; старейшая — первой', () => {
    expect(awaitingSend(rows)).toMatchObject({ count: 2, totalMinor: 175_50, oldest: { id: 'b' } });
    expect(awaitingSend([w({ status: 'sent' })]).count).toBe(0);
  });

  it('склонение «заявка»', () => {
    expect([1, 2, 5, 11, 21, 22, 25, 112].map(requestsWord)).toEqual([
      'заявка', 'заявки', 'заявок', 'заявок', 'заявка', 'заявки', 'заявок', 'заявок',
    ]);
  });

  it('плашка: число, сумма в USDT, следующий шаг и ссылка на старейшую', () => {
    const html = renderToStaticMarkup(<AwaitingSendBanner rows={rows} filter="open" selectedId="e" />);
    expect(html).toContain('Ждут вашей отправки: 2 заявки на');
    expect(html).toContain('175,50');
    expect(html).toContain('USDT');
    expect(html).toContain('Внести хэш');
    expect(html).toContain('w=b');
    expect(html).toContain('role="alert"');
  });

  it('нечего отправлять — плашки нет', () => {
    expect(renderToStaticMarkup(<AwaitingSendBanner rows={[rows[2]!, rows[3]!]} filter="open" selectedId={undefined} />)).toBe('');
  });
});
