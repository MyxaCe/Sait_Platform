import { describe, expect, it } from 'vitest';
import { clampViewTtl, issueViewUrl, MAX_VIEW_TTL_SECONDS, MIN_VIEW_TTL_SECONDS } from './storage';
import type { StorageEnvSource } from './config';

/**
 * ADM-12 · выдача подписанной ссылки. Подпись SigV4 считается локально (без
 * сети), поэтому срок и адресацию можно проверить без живого хранилища.
 */
const source: StorageEnvSource = {
  S3_ENDPOINT: 'http://minio.local:9000',
  S3_BUCKET: 'kyc-docs',
  S3_ACCESS_KEY_ID: 'AKIAEXAMPLE',
  S3_SECRET_ACCESS_KEY: 'secret',
  S3_REGION: 'us-east-1',
};

describe('clampViewTtl', () => {
  it('зажимает слишком короткий срок к нижней границе (5 мин)', () => {
    expect(clampViewTtl(60)).toBe(MIN_VIEW_TTL_SECONDS);
  });
  it('зажимает слишком длинный срок к верхней границе (15 мин)', () => {
    expect(clampViewTtl(3600)).toBe(MAX_VIEW_TTL_SECONDS);
  });
  it('нечисло → умолчание в окне', () => {
    expect(clampViewTtl(undefined)).toBeGreaterThanOrEqual(MIN_VIEW_TTL_SECONDS);
    expect(clampViewTtl(undefined)).toBeLessThanOrEqual(MAX_VIEW_TTL_SECONDS);
  });
});

describe('issueViewUrl', () => {
  const key = 'kyc/apex-ru/22222222-2222-2222-2222-222222222222/identity/uuid';

  it('подписывает GET на нужный бакет/ключ и кладёт зажатый срок в X-Amz-Expires', async () => {
    const url = await issueViewUrl(key, { ttlSeconds: 3600 }, source);
    const parsed = new URL(url);
    expect(parsed.pathname).toContain('kyc-docs');
    expect(parsed.pathname).toContain('identity');
    // 3600 → зажато к 900 (15 мин).
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe(String(MAX_VIEW_TTL_SECONDS));
    expect(parsed.searchParams.get('X-Amz-Signature')).toBeTruthy();
  });

  it('слишком короткий срок тоже зажимается (нижняя граница)', async () => {
    const url = await issueViewUrl(key, { ttlSeconds: 1 }, source);
    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe(String(MIN_VIEW_TTL_SECONDS));
  });
});
