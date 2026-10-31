import { S3Client } from '@aws-sdk/client-s3';
import { loadStorageConfig, type StorageConfig, type StorageEnvSource } from './config';

/**
 * S3-клиент из конфигурации. Мемоизируется на `globalThis` по отпечатку
 * конфигурации: в dev Next пересоздаёт модули между запросами, и без общего
 * стора мы плодили бы по клиенту на запрос (у `pg`-пулов та же защита). Смена
 * конфигурации (другой бакет/эндпоинт в тесте) даёт новый отпечаток → новый
 * клиент, старый не переиспользуется ошибочно.
 */
const globalStore = globalThis as unknown as {
  __kycStorageClient?: { fingerprint: string; client: S3Client };
};

function fingerprint(cfg: StorageConfig): string {
  // Секрет в отпечаток не кладём — хватает того, что адресует бэкенд.
  return `${cfg.endpoint ?? 'aws'}|${cfg.region}|${cfg.bucket}|${cfg.forcePathStyle}|${cfg.accessKeyId}`;
}

export function getStorageClient(source: StorageEnvSource = process.env): S3Client {
  const cfg = loadStorageConfig(source);
  const fp = fingerprint(cfg);
  if (globalStore.__kycStorageClient?.fingerprint === fp) {
    return globalStore.__kycStorageClient.client;
  }
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint ?? undefined,
    forcePathStyle: cfg.forcePathStyle,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  globalStore.__kycStorageClient = { fingerprint: fp, client };
  return client;
}
