import type { KeyObject } from 'node:crypto';
import { loadSigningKey, publicKeyPemOf, type TransferTerminalPort } from '@broker/transfer';
import type { OperatorRole } from '../auth/session';
import { moneyPool, terminalMoney, terminalReader } from '../crypto/runtime';

/**
 * Связка админки с `@broker/transfer`: своя платформа (SITE_SLUG), ключ
 * подписи из env ячейки (`PLATFORM_TRANSFER_SIGNING_KEY_PEM_B64`) и порт
 * терминала (заморозка торговли, баланс реального счёта).
 */

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

/** Публичный ключ своей платформы (PEM) — для реестров соседей. `null` — ключ не задан. */
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
    async realBalanceMinor(userId) {
      const r = await terminalReader().accounts(userId);
      if (r.state !== 'ok') return 'unavailable';
      const real = r.accounts.find((a) => a.kind === 'real');
      if (!real || !real.opened) return null;
      return real.balanceMinor ?? 0;
    },
  };
}

/** Видит «Переводы клиентов» целиком и делает «Вернуть перевод» — только admin. */
export function canReviewTransfers(role: OperatorRole | null | undefined): boolean {
  return role === 'admin';
}
