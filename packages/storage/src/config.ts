import { readEnv } from '@broker/utils';

/**
 * Конфигурация S3-совместимого объектного хранилища KYC (ADM-12, Р-454 II-1).
 *
 * ## Один клиент — два бэкенда (MinIO self-hosted и AWS S3)
 *
 * Endpoint КОНФИГУРИРУЕМ: пустой `S3_ENDPOINT` → клиент говорит с AWS S3 по
 * региону; заданный — с любым S3-совместимым сервером (MinIO на своём VPS).
 * Код против протокола, а не против поставщика: переезд между ними — смена
 * окружения, не правка кода.
 *
 * ## Источник секретов АБСТРАГИРОВАН (сегодня env, завтра Vault)
 *
 * Значения читаются из `StorageEnvSource` — им по умолчанию служит
 * `process.env`, но это ровно один параметр. Когда секреты переедут в Vault,
 * меняется поставщик источника (одна функция, отдающая тот же словарь), а не
 * этот модуль и не его вызывающие. Ключи в коде НЕ хардкодятся никогда.
 *
 * ## fail-closed: пустой конфиг — ОТКАЗ, а не заглушка
 *
 * Нет бакета или ключей → `StorageNotConfiguredError`, а не локальная папка и
 * не «клиент в никуда». Беззвучная заглушка в проде писала бы файлы клиентов
 * мимо хранилища, и обнаружилось бы это тогда, когда оператор не смог бы их
 * открыть. Отказ виден сразу (урок WEB-21/PKG-05: незаданное — это отказ, а
 * не умолчание). Пустая строка здесь — отсутствие (`readEnv`), по той же
 * причине: `S3_BUCKET=` в компоузе не должен проходить за заданный бакет.
 */

export interface StorageConfig {
  /** `null` → эндпоинт по умолчанию для региона (AWS S3). Иначе — MinIO/прочее. */
  endpoint: string | null;
  /** Регион подписи. MinIO его игнорирует, но SigV4 требует значение. */
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * Path-style адресация (`endpoint/bucket/key` вместо `bucket.endpoint/key`).
   * MinIO без wildcard-DNS работает только так; AWS S3 умеет обе. Умолчание:
   * включено, если задан кастомный endpoint (почти всегда это MinIO).
   */
  forcePathStyle: boolean;
}

/** Источник значений конфигурации. По умолчанию — окружение процесса. */
export type StorageEnvSource = Record<string, string | undefined>;

/**
 * Хранилище не настроено. Отдельный класс, а не голый `Error`: вызывающий
 * (загрузка в кабинете, выдача ссылки в админке) обязан отличать «хранилище
 * не сконфигурировано» от сетевого сбоя и отвечать на него fail-closed.
 */
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

/**
 * Собирает конфигурацию из источника или бросает `StorageNotConfiguredError`,
 * перечислив ВСЁ недостающее сразу (а не по одному за прогон — чтобы ops
 * увидел полный список за один отказ).
 */
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
  // Регион нужен SigV4 даже у MinIO; 'us-east-1' — безопасное умолчание для
  // S3-совместимых серверов, которым регион безразличен.
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
