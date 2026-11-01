import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initialStateFor, transition } from './state-machine';

/**
 * Р-452 · стейт-машина dual control: переходы, порог, запрет self-approval.
 * Порог задаём env, чтобы «ниже/выше порога» были детерминированы.
 */

beforeEach(() => {
  process.env.MONEY_DUAL_CONTROL_THRESHOLD_MINOR = '1000';
});
afterEach(() => {
  delete process.env.MONEY_DUAL_CONTROL_THRESHOLD_MINOR;
});

describe('initialStateFor', () => {
  it('finance_operator ниже порога → draft (готова к подписи)', () => {
    expect(initialStateFor('finance_operator', '500')).toBe('draft');
  });
  it('finance_operator выше порога → awaiting_second_approval', () => {
    expect(initialStateFor('finance_operator', '2000')).toBe('awaiting_second_approval');
  });
  it('Р-455 R-2-поправка: admin → draft на ЛЮБУЮ сумму (освобождён от второго аппрува)', () => {
    expect(initialStateFor('admin', '999999')).toBe('draft');
    expect(initialStateFor('admin', '1')).toBe('draft');
  });
  it('break-glass (admin-only) → draft даже при большой сумме', () => {
    expect(initialStateFor('admin', '999999', true)).toBe('draft');
  });
  it('порог = 0 (дефолт Р-452): finance_operator — любая сумма требует второго аппрува', () => {
    delete process.env.MONEY_DUAL_CONTROL_THRESHOLD_MINOR;
    expect(initialStateFor('finance_operator', '1')).toBe('awaiting_second_approval');
  });
  it('порог = 0: admin всё равно в draft (исключение сильнее порога)', () => {
    delete process.env.MONEY_DUAL_CONTROL_THRESHOLD_MINOR;
    expect(initialStateFor('admin', '1')).toBe('draft');
  });
});

describe('переходы', () => {
  it('draft + sign finance_operator (ниже порога) → signed', () => {
    expect(transition('draft', { kind: 'sign', role: 'finance_operator', amountMinor: '500' })).toEqual({
      ok: true,
      state: 'signed',
    });
  });

  it('draft + sign finance_operator (ВЫШЕ порога, без второго) → отказ secondApprovalRequired', () => {
    expect(transition('draft', { kind: 'sign', role: 'finance_operator', amountMinor: '2000' })).toEqual({
      ok: false,
      error: 'secondApprovalRequired',
    });
  });

  it('Р-455 R-2-поправка: draft + sign admin (ВЫШЕ порога, без второго) → signed', () => {
    expect(transition('draft', { kind: 'sign', role: 'admin', amountMinor: '2000' })).toEqual({
      ok: true,
      state: 'signed',
    });
  });

  it('draft + sign (выше порога, но break-glass admin) → signed', () => {
    expect(
      transition('draft', { kind: 'sign', role: 'admin', amountMinor: '2000', breakGlass: true }),
    ).toEqual({ ok: true, state: 'signed' });
  });

  it('awaiting + secondApprove разными учётками → signed', () => {
    expect(
      transition('awaiting_second_approval', {
        kind: 'secondApprove',
        initiatorId: 'op-A',
        approverId: 'op-B',
      }),
    ).toEqual({ ok: true, state: 'signed' });
  });

  it('awaiting + secondApprove ТОЙ ЖЕ учёткой → selfApprovalForbidden', () => {
    expect(
      transition('awaiting_second_approval', {
        kind: 'secondApprove',
        initiatorId: 'op-A',
        approverId: 'op-A',
      }),
    ).toEqual({ ok: false, error: 'selfApprovalForbidden' });
  });

  it('signed → dispatched → executed', () => {
    expect(transition('signed', { kind: 'dispatch' })).toEqual({ ok: true, state: 'dispatched' });
    expect(transition('dispatched', { kind: 'execute' })).toEqual({ ok: true, state: 'executed' });
  });

  it('dispatched + reject → rejected', () => {
    expect(transition('dispatched', { kind: 'reject' })).toEqual({ ok: true, state: 'rejected' });
  });

  it('терминальные состояния никуда не двигаются', () => {
    expect(transition('executed', { kind: 'dispatch' }).ok).toBe(false);
    expect(transition('rejected', { kind: 'execute' }).ok).toBe(false);
  });

  it('неописанный переход запрещён (fail-closed)', () => {
    expect(transition('draft', { kind: 'dispatch' })).toEqual({
      ok: false,
      error: 'illegalTransition',
    });
    expect(
      transition('awaiting_second_approval', { kind: 'sign', role: 'finance_operator', amountMinor: '500' }),
    ).toEqual({
      ok: false,
      error: 'illegalTransition',
    });
  });
});
