import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getStorageClient } from './client';
import { loadStorageConfig, type StorageEnvSource } from './config';

/**
 * Операции над объектами KYC (ADM-12 / CAB-KYC).
 *
 *  - `putObject` — приём файла стороной кабинета (клиент грузит свой документ).
 *  - `issueViewUrl` — выдача ВРЕМЕННОЙ подписанной ссылки оператору на просмотр.
 *
 * Байты KYC НЕ раздаются публично и не проксируются через приложение: оператор
 * получает подписанный URL с коротким сроком и идёт в хранилище напрямую.
 * Срок жёстко зажат в окно 5–15 минут — не настройка на усмотрение вызывающего:
 * слишком долгий срок превращает «временную ссылку» в постоянную утечку, а
 * выданная ссылка неотзывна до истечения.
 */

/** Нижняя граница TTL подписанной ссылки, сек (5 минут). */
export const MIN_VIEW_TTL_SECONDS = 5 * 60;
/** Верхняя граница TTL подписанной ссылки, сек (15 минут). */
export const MAX_VIEW_TTL_SECONDS = 15 * 60;
/** Умолчание TTL, сек (10 минут) — середина окна. */
export const DEFAULT_VIEW_TTL_SECONDS = 10 * 60;

export interface PutObjectInput {
  /** Ключ объекта (`buildKycObjectKey`). */
  key: string;
  /** Содержимое файла. */
  body: Uint8Array | Buffer;
  /** MIME поданного файла. */
  contentType?: string;
}

/** Кладёт объект в бакет из конфигурации. Бросает, если хранилище не настроено. */
export async function putObject(
  input: PutObjectInput,
  source: StorageEnvSource = process.env,
): Promise<void> {
  const { bucket } = loadStorageConfig(source);
  const client = getStorageClient(source);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
}

/** Зажимает TTL в окно [MIN, MAX]; нечисло/отсутствие → умолчание. */
export function clampViewTtl(ttlSeconds: number | undefined): number {
  if (typeof ttlSeconds !== 'number' || !Number.isFinite(ttlSeconds)) {
    return DEFAULT_VIEW_TTL_SECONDS;
  }
  return Math.min(MAX_VIEW_TTL_SECONDS, Math.max(MIN_VIEW_TTL_SECONDS, Math.floor(ttlSeconds)));
}

export interface IssueViewUrlOptions {
  /** Желаемый срок жизни ссылки, сек. Всегда зажимается в [5, 15] минут. */
  ttlSeconds?: number;
}

/**
 * Выдаёт временную подписанную GET-ссылку на объект по его `storageKey`.
 * Срок зажат в окно 5–15 минут независимо от запрошенного значения.
 */
export async function issueViewUrl(
  storageKey: string,
  options: IssueViewUrlOptions = {},
  source: StorageEnvSource = process.env,
): Promise<string> {
  const { bucket } = loadStorageConfig(source);
  const client = getStorageClient(source);
  const expiresIn = clampViewTtl(options.ttlSeconds);
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: storageKey }), {
    expiresIn,
  });
}
