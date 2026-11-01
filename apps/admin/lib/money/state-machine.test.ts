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
    expect(initialStateFor('finance_operator', '500', false)).toBe('draft');
  });
  it('finance_operator выше порога → awaiting_second_approval', () => {
    expect(initialStateFor('finance_operator', '2000', false)).toBe('awaiting_second_approval');
  });
  it('Р-456 C: admin ПРИ bootstrap → draft на ЛЮБУЮ сумму', () => {
    expect(initialStateFor('admin', '999999', true)).toBe('draft');
    expect(initialStateFor('admin', '1', true)).toBe('draft');
  });
  it('Р-456 C: admin БЕЗ bootstrap → по порогу как finance_operator (выше порога → awaiting)', () => {
    expect(initialStateFor('admin', '2000', false)).toBe('awaiting_second_approval');
    expect(initialStateFor('admin', '500', false)).toBe('draft');
  });
  it('break-glass (admin-only) → draft даже при большой сумме и без bootstrap', () => {
    expect(initialStateFor('admin', '999999', false, true)).toBe('draft');
  });
  it('порог = 0 (дефолт Р-452): finance_operator — любая сумма требует второго аппрува', () => {
    delete process.env.MONEY_DUAL_CONTROL_THRESHOLD_MINOR;
    expect(initialStateFor('finance_operator', '1', false)).toBe('awaiting_second_approval');
  });
  it('Р-456 C: порог = 0, admin БЕЗ bootstrap → awaiting (освобождение снято)', () => {
    delete process.env.MONEY_DUAL_CONTROL_THRESHOLD_MINOR;
    expect(initialStateFor('admin', '1', false)).toBe('awaiting_second_approval');
  });
  it('Р-456 C: порог = 0, admin ПРИ bootstrap → draft (временное исключение)', () => {
    delete process.env.MONEY_DUAL_CONTROL_THRESHOLD_MINOR;
    expect(initialStateFor('admin', '1', true)).toBe('draft');
  });
});

describe('переходы', () => {
  it('draft + sign finance_operator (ниже порога) → signed', () => {
    expect(
      transition('draft', { kind: 'sign', role: 'finance_operator', amountMinor: '500', bootstrapMode: false }),
    ).toEqual({ ok: true, state: 'signed' });
  });

  it('draft + sign finance_operator (ВЫШЕ порога, без второго) → отказ secondApprovalRequired', () => {
    expect(
      transition('draft', { kind: 'sign', role: 'finance_operator', amountMinor: '2000', bootstrapMode: false }),
    ).toEqual({ ok: false, error: 'secondApprovalRequired' });
  });

  it('Р-456 C: draft + sign admin ПРИ bootstrap (ВЫШЕ порога) → signed (self-approval разрешён)', () => {
    expect(
      transition('draft', { kind: 'sign', role: 'admin', amountMinor: '2000', bootstrapMode: true }),
    ).toEqual({ ok: true, state: 'signed' });
  });

  it('Р-456 C: draft + sign admin БЕЗ bootstrap (ВЫШЕ порога) → secondApprovalRequired (освобождение снято)', () => {
    expect(
      transition('draft', { kind: 'sign', role: 'admin', amountMinor: '2000', bootstrapMode: false }),
    ).toEqual({ ok: false, error: 'secondApprovalRequired' });
  });

  it('draft + sign (выше порога, но break-glass admin) → signed (вне зависимости от bootstrap)', () => {
    expect(
      transition('draft', { kind: 'sign', role: 'admin', amountMinor: '2000', bootstrapMode: false, breakGlass: true }),
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
      transition('awaiting_second_approval', {
        kind: 'sign',
        role: 'finance_operator',
        amountMinor: '500',
        bootstrapMode: false,
      }),
    ).toEqual({
      ok: false,
      error: 'illegalTransition',
    });
  });
});
