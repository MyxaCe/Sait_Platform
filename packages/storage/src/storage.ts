import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getStorageClient } from './client';
import { loadStorageConfig, type StorageEnvSource } from './config';

export const MIN_VIEW_TTL_SECONDS = 5 * 60;
export const MAX_VIEW_TTL_SECONDS = 15 * 60;
export const DEFAULT_VIEW_TTL_SECONDS = 10 * 60;

export interface PutObjectInput {
  key: string;
  body: Uint8Array | Buffer;
  contentType?: string;
}

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

export function clampViewTtl(ttlSeconds: number | undefined): number {
  if (typeof ttlSeconds !== 'number' || !Number.isFinite(ttlSeconds)) {
    return DEFAULT_VIEW_TTL_SECONDS;
  }
  return Math.min(MAX_VIEW_TTL_SECONDS, Math.max(MIN_VIEW_TTL_SECONDS, Math.floor(ttlSeconds)));
}

export interface IssueViewUrlOptions {
  ttlSeconds?: number;
}

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
