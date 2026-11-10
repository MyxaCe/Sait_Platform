import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_DOC_BYTES, SERVER_ACTION_BODY_LIMIT_BYTES } from '@/upload-limits.mjs';

/**
 * KYC-загрузка > 1 МБ (волна 3). Server actions Next 14 режут тело на 1 МБ по
 * умолчанию — фото паспорта с телефона не доходило до нашей проверки размера.
 * Проверяем: (1) конфиг Next поднимает потолок из того же источника, что и
 * лимит файла, с запасом на multipart; (2) action принимает файл в несколько
 * МБ и отдаёт понятное `fileTooLarge` сверх лимита.
 */

const env = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  put: vi.fn(async () => undefined),
  query: vi.fn(async () => ({ rows: [] })),
}));

vi.mock('./auth/session', () => ({ getSessionUser: async () => env.user }));
vi.mock('./db', () => ({
  getPool: () => ({ connect: async () => ({ query: env.query, release: () => {} }) }),
}));
vi.mock('@broker/storage', () => ({
  putObject: env.put,
  buildKycObjectKey: ({ client, docKind, uuid }: { client: string; docKind: string; uuid: string }) =>
    `t/${client}/${docKind}/${uuid}`,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

function form(size: number): FormData {
  const fd = new FormData();
  fd.set('kind', 'identity');
  fd.set('file', new File([new Uint8Array(size)], 'identity.jpg', { type: 'image/jpeg' }));
  return fd;
}

beforeEach(async () => {
  process.env.SITE_SLUG = 'demo';
  env.put.mockClear();
  const { __resetRateLimit } = await import('./rate-limit');
  __resetRateLimit();
});

describe('потолок тела server action ≥ лимита KYC-файла', () => {
  it('next.config.mjs выставляет serverActions.bodySizeLimit из upload-limits', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const text = readFileSync(path.resolve(__dirname, '../next.config.mjs'), 'utf8');
    expect(text).toMatch(/from '\.\/upload-limits\.mjs'/);
    expect(text).toMatch(/serverActions:\s*\{\s*bodySizeLimit:\s*SERVER_ACTION_BODY_LIMIT_BYTES\s*\}/);
  });

  it('потолок больше 1 МБ и больше лимита файла (запас на multipart)', () => {
    expect(MAX_DOC_BYTES).toBe(10 * 1024 * 1024);
    expect(SERVER_ACTION_BODY_LIMIT_BYTES).toBeGreaterThan(MAX_DOC_BYTES);
    expect(SERVER_ACTION_BODY_LIMIT_BYTES - MAX_DOC_BYTES).toBeGreaterThanOrEqual(512 * 1024);
  });
});

describe('submitKycDocumentAction и размер файла', () => {
  it('файл 5 МБ принимается и уходит в хранилище', async () => {
    const { submitKycDocumentAction } = await import('./kyc-actions');
    expect(await submitKycDocumentAction({}, form(5 * 1024 * 1024))).toEqual({ ok: true });
    expect(env.put).toHaveBeenCalledOnce();
  });

  it('файл сверх лимита — fileTooLarge, в хранилище не пишем', async () => {
    const { submitKycDocumentAction } = await import('./kyc-actions');
    expect(await submitKycDocumentAction({}, form(MAX_DOC_BYTES + 1))).toEqual({
      fieldErrors: { file: 'fileTooLarge' },
    });
    expect(env.put).not.toHaveBeenCalled();
  });
});
