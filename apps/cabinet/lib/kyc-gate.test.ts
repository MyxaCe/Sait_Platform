import { describe, expect, it, vi } from 'vitest';

vi.mock('./db', () => ({ getPool: () => { throw new Error('pool не должен трогаться'); } }));

/**
 * Гейт KYC на деньги: `true` только при `verified`, всё прочее — fail-closed.
 */
function fakeDb(state: string | null) {
  return {
    query: async () => ({ rows: state === null ? [] : [{ state }] }),
  };
}

describe('isKycVerified', () => {
  it('verified → true', async () => {
    const { isKycVerified } = await import('./kyc');
    expect(await isKycVerified('u', fakeDb('verified'))).toBe(true);
  });

  it.each([null, 'unverified', 'pending', 'rejected', 'resubmit_requested'])(
    '%s → false (fail-closed)',
    async (state) => {
      const { isKycVerified } = await import('./kyc');
      expect(await isKycVerified('u', fakeDb(state))).toBe(false);
    },
  );
});
