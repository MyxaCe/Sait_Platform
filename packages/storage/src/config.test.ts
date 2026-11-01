import { describe, expect, it } from 'vitest';
import { loadStorageConfig, StorageNotConfiguredError, type StorageEnvSource } from './config';

/**
 * ADM-12 · конфигурация хранилища: источник абстрагирован (словарь, по
 * умолчанию env), пустой конфиг — ОТКАЗ (fail-closed), пустая строка —
 * отсутствие (не «заданное пустое»).
 */
const full: StorageEnvSource = {
  S3_BUCKET: 'kyc-docs',
  S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
  S3_SECRET_ACCESS_KEY: 'secret',
};

describe('loadStorageConfig', () => {
  it('fail-closed: без бакета и ключей бросает и называет ВСЁ недостающее', () => {
    try {
      loadStorageConfig({});
      expect.unreachable('должно было бросить');
    } catch (e) {
      expect(e).toBeInstanceOf(StorageNotConfiguredError);
      const msg = (e as Error).message;
      expect(msg).toContain('S3_BUCKET');
      expect(msg).toContain('S3_ACCESS_KEY_ID');
      expect(msg).toContain('S3_SECRET_ACCESS_KEY');
    }
  });

  it('пустая строка — это отсутствие, а не заданное значение', () => {
    expect(() => loadStorageConfig({ ...full, S3_BUCKET: '  ' })).toThrow(StorageNotConfiguredError);
  });

  it('без endpoint — режим AWS S3: endpoint=null, path-style выключен', () => {
    const cfg = loadStorageConfig(full);
    expect(cfg.endpoint).toBeNull();
    expect(cfg.forcePathStyle).toBe(false);
    expect(cfg.region).toBe('us-east-1');
    expect(cfg.bucket).toBe('kyc-docs');
  });

  it('с кастомным endpoint (MinIO) — path-style включается по умолчанию', () => {
    const cfg = loadStorageConfig({ ...full, S3_ENDPOINT: 'http://minio.local:9000' });
    expect(cfg.endpoint).toBe('http://minio.local:9000');
    expect(cfg.forcePathStyle).toBe(true);
  });

  it('S3_FORCE_PATH_STYLE=false перекрывает умолчание даже при endpoint', () => {
    const cfg = loadStorageConfig({
      ...full,
      S3_ENDPOINT: 'http://minio.local:9000',
      S3_FORCE_PATH_STYLE: 'false',
    });
    expect(cfg.forcePathStyle).toBe(false);
  });
});
