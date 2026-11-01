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

/**
 * Подпись денежных команд Ed25519 (Р-452).
 *
 * Крипто — ТОЛЬКО `node:crypto` (Node 22 умеет Ed25519 через `sign/verify` с
 * алгоритмом `null` и `generateKeyPair('ed25519')`). НЕ нативные аддоны: урок
 * Р-453 — нативные `.node` ломают `next build`.
 *
 * Источник приватного ключа АБСТРАГИРОВАН интерфейсом `Ed25519KeyProvider`:
 * сейчас реализация из env (стенд/тесты), Vault — позже той же абстракцией.
 * ЖИВОЙ VAULT НЕ ПОДКЛЮЧЁН (нет сетевых вызовов, нет секретов в коде/БД).
 *
 * Приватный ключ — ТОЛЬКО у ЦУ; терминал держит лишь публичный (Р-452:
 * компрометация терминала не даёт подписать новые команды). Поэтому подпись
 * (`signMoneyCommand`) живёт за провайдером, а проверка (`verifyMoneyCommand`)
 * берёт голый публичный ключ — её переиспускает терминальная сторона.
 */

/**
 * Провайдер ключа подписи ЦУ. Абстрагирует ИСТОЧНИК приватного ключа (env
 * сейчас, Vault позже) — но не саму криптографию: подпись считает код ниже,
 * провайдер лишь выдаёт ключ и его версию.
 */
export interface Ed25519KeyProvider {
  /** Приватный ключ подписи (KeyObject Ed25519). Только у ЦУ. */
  privateKey(): KeyObject;
  /** Публичный ключ — тот, что раздаётся терминалу. */
  publicKey(): KeyObject;
  /** Версия ключа для ротации (Р-452): входит в подписанную команду. */
  keyVersion(): string;
}

/**
 * Провайдер из env. Ключи — PEM в base64 (PKCS8 для приватного, SPKI для
 * публичного), чтобы ничего бинарного не жило в переменных окружения как есть.
 * Отсутствие ключа — НЕ молчаливый дефолт: бросаем (fail-closed), подпись без
 * ключа невозможна по определению.
 */
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
      // Публичный выводится из приватного — не обязателен отдельно у ЦУ.
      this.pub = createPublicKey(this.privateKey());
    }
    return this.pub;
  }

  keyVersion(): string {
    return process.env.MONEY_SIGNING_KEY_VERSION ?? 'v1';
  }
}

/**
 * Статический провайдер из пары KeyObject — для тестов и для будущей
 * Vault-реализации (та отдаст KeyObject, собранный из секрета Vault). Не читает
 * env, не ходит в сеть.
 */
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

/** Генерация пары Ed25519 (`node:crypto`) — для тестов и начальной выдачи ключа ЦУ. */
export function generateEd25519KeyPair(): { privateKey: KeyObject; publicKey: KeyObject } {
  return generateKeyPairSync('ed25519');
}

/**
 * Подпись команды ключом ЦУ. Ed25519 → алгоритм `null` в `crypto.sign`.
 * Возвращает нагрузку + подпись (base64) + версию ключа — ровно то, что уходит
 * терминалу.
 */
export function signMoneyCommand(
  payload: MoneyCommandPayload,
  provider: Ed25519KeyProvider,
): SignedMoneyCommand {
  const signature = cryptoSign(null, commandSigningBytes(payload), provider.privateKey());
  return { payload, signature: signature.toString('base64'), keyVersion: provider.keyVersion() };
}

/**
 * Проверка подписи — чистая крипто-проверка над публичным ключом. Отделена от
 * проверок приёма (время/nonce/автор/основание), чтобы терминал мог вызвать
 * ровно её для сверки векторов. Любая ошибка (битая base64, не тот ключ) → false,
 * не исключение: провал проверки — это «нет», а не авария.
 */
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

/**
 * ПОРТЫ приёма команды терминалом (Р-452). На терминале (Rust) их реализует он
 * сам; здесь — интерфейсы + эталонная TS-проверка `verifyIncomingCommand`,
 * задающая однозначную семантику и тестируемая векторами.
 */
export interface AcceptancePorts {
  /** Публичный ключ ЦУ для заявленной версии; `null` — версия неизвестна (отказ). */
  publicKeyForVersion(version: string): KeyObject | null;
  /** nonce ещё НЕ встречался? true = свежий. На терминале — персистентный кэш. */
  isNonceFresh(nonce: string): boolean;
  /** Автор существует и активен? */
  isAuthorActive(initiatorId: string): boolean;
  /** Основание существует? */
  basisExists(basisRef: string): boolean;
  /** Часы проверяющего (мс). По умолчанию `Date.now`. */
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

/**
 * Проверка команды при приёме (Р-452): подпись → окно времени → nonce → автор →
 * основание. ЛЮБОЙ провал → ОТКЛОНИТЬ (не «пропустить с пометкой»). Порядок
 * важен: сначала крипто-подлинность, потом контекст — не тратим кэш/БД на
 * неподписанное. fail-closed во всём.
 */
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
