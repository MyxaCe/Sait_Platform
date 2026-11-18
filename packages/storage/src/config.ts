import { readEnv } from '@broker/utils';

export interface StorageConfig {
  endpoint: string | null;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export type StorageEnvSource = Record<string, string | undefined>;

export class StorageNotConfiguredError extends Error {
  readonly code = 'storage-not-configured';

  constructor(missing: readonly string[]) {
    super(
      `Объектное хранилище KYC не сконфигурировано: не заданы ${missing.join(', ')}. ` +
        'Код работает только против настроенного S3-совместимого хранилища ' +
        '(MinIO или AWS S3); локальной заглушки в проде нет — это отказ, а не ' +
        'умолчание (ADM-12, fail-closed). Задайте переменные окружения ' +
        'хранилища (позже — источник Vault).',
    );
    this.name = 'StorageNotConfiguredError';
  }
}

export function loadStorageConfig(source: StorageEnvSource = process.env): StorageConfig {
  const bucket = readEnv(source.S3_BUCKET);
  const accessKeyId = readEnv(source.S3_ACCESS_KEY_ID);
  const secretAccessKey = readEnv(source.S3_SECRET_ACCESS_KEY);

  const missing: string[] = [];
  if (!bucket) missing.push('S3_BUCKET');
  if (!accessKeyId) missing.push('S3_ACCESS_KEY_ID');
  if (!secretAccessKey) missing.push('S3_SECRET_ACCESS_KEY');
  if (missing.length > 0) {
    throw new StorageNotConfiguredError(missing);
  }

  const endpoint = readEnv(source.S3_ENDPOINT);
  const region = readEnv(source.S3_REGION) ?? 'us-east-1';

  const forcePathStyleRaw = readEnv(source.S3_FORCE_PATH_STYLE);
  const forcePathStyle =
    forcePathStyleRaw === null ? endpoint !== null : forcePathStyleRaw === 'true';

  return {
    endpoint,
    region,
    bucket: bucket!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    forcePathStyle,
  };
}
