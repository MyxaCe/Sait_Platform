import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Money, formatMinor, formatMoney } from './Money';
import { STATUS_DICTIONARY, statusKeyOf } from '../../molecules/StatusBadge/StatusBadge';

const N = ' ';

describe('Money — деньги в минорных единицах, валюта явно', () => {
  it('группирует тысячи узким неразрывным пробелом и держит 2 знака', () => {
    expect(formatMinor(4_825_013)).toBe(`48${N}250,13`);
    expect(formatMinor(5)).toBe('0,05');
    expect(formatMinor(-120_000)).toBe(`1${N}200,00`);
  });

  it('знак — типографский минус, плюс только при signed', () => {
    expect(formatMoney(-120_000, 'USDT')).toBe(`−1${N}200,00${N}USDT`);
    expect(formatMoney(82_017, 'USDT', true)).toBe(`+820,17${N}USDT`);
    expect(formatMoney(82_017, 'USDT')).toBe(`820,17${N}USDT`);
  });

  it('null → «—», а не 0,00', () => {
    render(<Money minor={null} currency="USDT" />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('валюта показывается по умолчанию', () => {
    render(<Money minor={100} currency="USDT" />);
    expect(screen.getByText('USDT')).toBeTruthy();
  });
});

describe('STATUS_DICTIONARY — единая семантика тонов', () => {
  it('«ждёт оператора» — warning, «отказ/ограничение» — negative', () => {
    expect(STATUS_DICTIONARY.pending.tone).toBe('warning');
    expect(STATUS_DICTIONARY.withdrawal_needs_review.tone).toBe('warning');
    expect(STATUS_DICTIONARY.aml_escalated.tone).toBe('negative');
    expect(STATUS_DICTIONARY.blocked.tone).toBe('negative');
    expect(STATUS_DICTIONARY.deposit_credited.tone).toBe('positive');
  });

  it('statusKeyOf пропускает только известные ключи', () => {
    expect(statusKeyOf('deposit_credited')).toBe('deposit_credited');
    expect(statusKeyOf('deposit_bogus')).toBeUndefined();
    expect(statusKeyOf('toString')).toBeUndefined();
  });
});
