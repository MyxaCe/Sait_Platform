import type { KeyObject } from 'node:crypto';
import { loadSigningKey, publicKeyPemOf, type TransferTerminalPort } from '@broker/transfer';
import type { OperatorRole } from '../auth/session';
import { moneyPool, terminalMoney, terminalReader } from '../crypto/runtime';

export { moneyPool as transferPool };

export function selfSlug(): string | null {
  const v = process.env.SITE_SLUG?.trim();
  return v && /^[a-z0-9][a-z0-9-]{1,31}$/.test(v) ? v : null;
}

const store = globalThis as unknown as { __transferKey?: KeyObject | null };

export function signingKey(): KeyObject | null {
  if (store.__transferKey === undefined) store.__transferKey = loadSigningKey();
  return store.__transferKey;
}

export function selfPublicKeyPem(): string | null {
  const k = signingKey();
  return k ? publicKeyPemOf(k) : null;
}

export function transferTerminal(): TransferTerminalPort {
  return {
    async setTradingFrozen(userId, frozen, reason) {
      const out = await terminalMoney().tradingFreeze(userId, { frozen, reason, operator: 'system:platform-transfer' }, 'real');
      return out.state;
    },
    async realAccountState(userId) {
      const r = await terminalReader().accounts(userId);
      if (r.state !== 'ok') return 'unavailable';
      const real = r.accounts.find((a) => a.kind === 'real');
      if (!real || !real.opened) return null;
      return { balanceMinor: real.balanceMinor, equityMinor: real.equityMinor, openPositions: real.openPositions };
    },
  };
}

export function canReviewTransfers(role: OperatorRole | null | undefined): boolean {
  return role === 'admin';
}
