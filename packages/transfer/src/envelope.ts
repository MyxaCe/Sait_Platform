import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import { canonicalize } from '@broker/money';

/**
 * Межплатформенное сообщение и его подпись (Ed25519, `node:crypto`).
 *
 * Модель доверия:
 *  - приватный ключ платформы — ТОЛЬКО в env её ячейки
 *    (`PLATFORM_TRANSFER_SIGNING_KEY_PEM_B64`), не в базе и не в CMS;
 *  - публичные ключи соседей — в реестре платформ группы (`group_platforms`),
 *    их вносит admin с основанием и записью в журнал;
 *  - подписывается КАНОНИЧЕСКАЯ форма конверта (рекурсивно отсортированные
 *    ключи — тот же `canonicalize`, что у хеш-цепочки журнала), поэтому
 *    перестановка полей при сериализации подпись не ломает;
 *  - защита от повтора: случайный `nonce` (одноразовый у получателя) и
 *    `issuedAt` в окне ±5 минут; идемпотентность по смыслу — `transferId` +
 *    тип + событие (повторная доставка того же факта — «дубликат», не ошибка).
 *
 * Нативных аддонов нет (урок Р-453: `.node` ломают `next build`).
 */

export const PROTOCOL_VERSION = 1 as const;
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;
export const MESSAGES_PATH = '/api/platform-transfer/v1/messages';

export type MessageKind = 'transfer.package' | 'transfer.revoke' | 'transfer.status';
export const MESSAGE_KINDS: readonly MessageKind[] = ['transfer.package', 'transfer.revoke', 'transfer.status'];

export interface Envelope<D = unknown> {
  v: typeof PROTOCOL_VERSION;
  kind: MessageKind;
  /** id строки outbox отправителя (для трассировки, не для идемпотентности). */
  messageId: string;
  from: string;
  to: string;
  transferId: string;
  issuedAt: string;
  nonce: string;
  data: D;
}

export interface SignedMessage<D = unknown> {
  envelope: Envelope<D>;
  /** base64 подписи Ed25519 над `canonicalize(envelope)`. */
  signature: string;
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Хеш содержимого по канонической форме (пакет, доказательство). */
export function canonicalSha256(value: unknown): string {
  return sha256Hex(canonicalize(value));
}

export function envelopeBytes(envelope: Envelope): Buffer {
  return Buffer.from(canonicalize(envelope), 'utf8');
}

export function newNonce(): string {
  return randomBytes(18).toString('base64url');
}

export function signEnvelope<D>(envelope: Envelope<D>, privateKey: KeyObject): SignedMessage<D> {
  const signature = cryptoSign(null, envelopeBytes(envelope as Envelope), privateKey).toString('base64');
  return { envelope, signature };
}

/** Любая ошибка (битый ключ, битая base64) — «подпись неверна», не авария. */
export function verifyEnvelope(message: SignedMessage, publicKeyPem: string): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return false;
    return cryptoVerify(null, envelopeBytes(message.envelope), key, Buffer.from(message.signature, 'base64'));
  } catch {
    return false;
  }
}

export const SIGNING_KEY_ENV = 'PLATFORM_TRANSFER_SIGNING_KEY_PEM_B64';

/**
 * Приватный ключ платформы из env (PKCS8 PEM в base64). Нет ключа — `null`:
 * отправка сообщений невозможна (fail-closed), админка показывает «ключ не
 * задан», а приём (проверка чужих подписей) продолжает работать.
 */
export function loadSigningKey(env: Record<string, string | undefined> = process.env): KeyObject | null {
  const b64 = env[SIGNING_KEY_ENV]?.trim();
  if (!b64) return null;
  try {
    const key = createPrivateKey(Buffer.from(b64, 'base64').toString('utf8'));
    return key.asymmetricKeyType === 'ed25519' ? key : null;
  } catch {
    return null;
  }
}

export function publicKeyPemOf(privateKey: KeyObject): string {
  return createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString().trim();
}

/** Короткий отпечаток ключа для журнала и сверки глазами (sha256 SPKI DER, 16 hex). */
export function keyFingerprint(publicKeyPem: string | null | undefined): string | null {
  if (!publicKeyPem) return null;
  try {
    const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
    return sha256Hex(der).slice(0, 16);
  } catch {
    return null;
  }
}

export function isValidEd25519PublicKeyPem(pem: string): boolean {
  try {
    return createPublicKey(pem).asymmetricKeyType === 'ed25519';
  } catch {
    return false;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{1,31}$/;

/** Строгая проверка формы входящего сообщения (производитель строг, потребитель — тоже: это граница доверия). */
export function parseSignedMessage(raw: unknown): SignedMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const e = m.envelope as Record<string, unknown> | undefined;
  if (typeof m.signature !== 'string' || m.signature.length > 200 || !e || typeof e !== 'object') return null;
  if (e.v !== PROTOCOL_VERSION) return null;
  if (!MESSAGE_KINDS.includes(e.kind as MessageKind)) return null;
  for (const k of ['messageId', 'from', 'to', 'transferId', 'issuedAt', 'nonce'] as const) {
    if (typeof e[k] !== 'string' || (e[k] as string).length > 200) return null;
  }
  if (!UUID.test(e.transferId as string) || !SLUG.test(e.from as string) || !SLUG.test(e.to as string)) return null;
  if (Number.isNaN(Date.parse(e.issuedAt as string))) return null;
  if (!e.data || typeof e.data !== 'object') return null;
  return { envelope: e as unknown as Envelope, signature: m.signature };
}
