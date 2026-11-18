import { describe, expect, it } from 'vitest';
import { toVerificationStatus } from './home';

describe('статус верификации главной ← client_verification', () => {
  it('verified → approved (никакого «Пройти верификацию»)', () => {
    expect(toVerificationStatus('verified')).toBe('approved');
  });
  it('pending → pending', () => {
    expect(toVerificationStatus('pending')).toBe('pending');
  });
  it('rejected → rejected (нужно подать заново)', () => {
    expect(toVerificationStatus('rejected')).toBe('rejected');
  });
  it('нет строки / не подавал → none', () => {
    expect(toVerificationStatus(null)).toBe('none');
    expect(toVerificationStatus('unverified')).toBe('none');
  });
});
