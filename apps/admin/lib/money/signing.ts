import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import { commandSigningBytes } from './canonical';
import { clockSkewMs, timestampWindowMs } from './config';
import type { MoneyCommandPayload, SignedMoneyCommand } from './types';

export interface Ed25519KeyProvider {
  privateKey(): KeyObject;
  publicKey(): KeyObject;
  keyVersion(): string;
}

export class EnvEd25519KeyProvider implements Ed25519KeyProvider {
  private priv: KeyObject | null = null;
  private pub: KeyObject | null = null;

  privateKey(): KeyObject {
    if (this.priv) return this.priv;
    const b64 = process.env.MONEY_SIGNING_KEY_PEM_B64;
    if (!b64) {
      throw new Error(
        'MONEY_SIGNING_KEY_PEM_B64 не задан — приватный ключ подписи только у ЦУ (Р-452), подписать нельзя',
      );
    }
    this.priv = createPrivateKey(Buffer.from(b64, 'base64').toString('utf8'));
    return this.priv;
  }

  publicKey(): KeyObject {
    if (this.pub) return this.pub;
    const b64 = process.env.MONEY_SIGNING_PUBKEY_PEM_B64;
    if (b64) {
      this.pub = createPublicKey(Buffer.from(b64, 'base64').toString('utf8'));
    } else {
      this.pub = createPublicKey(this.privateKey());
    }
    return this.pub;
  }

  keyVersion(): string {
    return process.env.MONEY_SIGNING_KEY_VERSION ?? 'v1';
  }
}

export class StaticEd25519KeyProvider implements Ed25519KeyProvider {
  constructor(
    private readonly priv: KeyObject,
    private readonly pub: KeyObject,
    private readonly version: string = 'v1',
  ) {}
  privateKey(): KeyObject {
    return this.priv;
  }
  publicKey(): KeyObject {
    return this.pub;
  }
  keyVersion(): string {
    return this.version;
  }
}

export function generateEd25519KeyPair(): { privateKey: KeyObject; publicKey: KeyObject } {
  return generateKeyPairSync('ed25519');
}

export function signMoneyCommand(
  payload: MoneyCommandPayload,
  provider: Ed25519KeyProvider,
): SignedMoneyCommand {
  const signature = cryptoSign(null, commandSigningBytes(payload), provider.privateKey());
  return { payload, signature: signature.toString('base64'), keyVersion: provider.keyVersion() };
}

export function verifyMoneyCommand(
  signed: SignedMoneyCommand,
  publicKey: KeyObject,
): boolean {
  try {
    return cryptoVerify(
      null,
      commandSigningBytes(signed.payload),
      publicKey,
      Buffer.from(signed.signature, 'base64'),
    );
  } catch {
    return false;
  }
}

export interface AcceptancePorts {
  publicKeyForVersion(version: string): KeyObject | null;
  isNonceFresh(nonce: string): boolean;
  isAuthorActive(initiatorId: string): boolean;
  basisExists(basisRef: string): boolean;
  now?: () => number;
}

export type AcceptanceRejection =
  | 'unknownKeyVersion'
  | 'badSignature'
  | 'expiredTimestamp'
  | 'futureTimestamp'
  | 'replayedNonce'
  | 'inactiveAuthor'
  | 'missingBasis';

export type AcceptanceResult = { ok: true } | { ok: false; reason: AcceptanceRejection };

export function verifyIncomingCommand(
  signed: SignedMoneyCommand,
  ports: AcceptancePorts,
): AcceptanceResult {
  const publicKey = ports.publicKeyForVersion(signed.keyVersion);
  if (!publicKey) return { ok: false, reason: 'unknownKeyVersion' };

  if (!verifyMoneyCommand(signed, publicKey)) return { ok: false, reason: 'badSignature' };

  const now = (ports.now ?? Date.now)();
  const issued = Date.parse(signed.payload.issuedAt);
  if (!Number.isFinite(issued)) return { ok: false, reason: 'expiredTimestamp' };
  if (issued > now + clockSkewMs()) return { ok: false, reason: 'futureTimestamp' };
  if (now - issued > timestampWindowMs()) return { ok: false, reason: 'expiredTimestamp' };

  if (!ports.isNonceFresh(signed.payload.nonce)) return { ok: false, reason: 'replayedNonce' };
  if (!ports.isAuthorActive(signed.payload.initiatorId)) return { ok: false, reason: 'inactiveAuthor' };
  if (!ports.basisExists(signed.payload.basisRef)) return { ok: false, reason: 'missingBasis' };

  return { ok: true };
}
