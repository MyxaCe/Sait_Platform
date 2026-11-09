import { describe, expect, it } from 'vitest';
import { toVerificationStatus } from './home';

/**
 * Аудит К6: подтверждённый оператором клиент видел на главной «Пройти
 * верификацию» — статус читался из старой заглушки `documents`, а решение
 * оператора живёт в `client_verification`. Статус главной обязан следовать
 * тому же источнику, что страница «Верификация» и денежный гейт KYC.
 */
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
