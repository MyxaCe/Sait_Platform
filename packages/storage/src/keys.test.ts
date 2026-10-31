import { describe, expect, it } from 'vitest';
import { buildKycObjectKey, InvalidKeySegmentError, KYC_KEY_PREFIX } from './keys';

/**
 * ADM-12 · схема ключа объекта KYC. Ключ — `kyc/{tenant}/{client}/{doc_type}/
 * {uuid}`; неугадываемость даёт uuid, адресацию защищает валидация сегментов.
 */
describe('buildKycObjectKey', () => {
  const ok = {
    tenant: 'apex-ru',
    client: '22222222-2222-2222-2222-222222222222',
    docKind: 'identity',
    uuid: '9f8e7d6c-0000-4a1b-8c2d-1234567890ab',
  };

  it('строит ключ ровно по схеме kyc/{tenant}/{client}/{doc_type}/{uuid}', () => {
    expect(buildKycObjectKey(ok)).toBe(
      `${KYC_KEY_PREFIX}/apex-ru/22222222-2222-2222-2222-222222222222/identity/9f8e7d6c-0000-4a1b-8c2d-1234567890ab`,
    );
  });

  it.each([
    ['пустой сегмент', { ...ok, tenant: '' }],
    ['слэш в сегменте', { ...ok, client: 'a/b' }],
    ['обратный слэш', { ...ok, docKind: 'id\\entity' }],
    ['обход пути ..', { ...ok, uuid: '..' }],
    ['точка .', { ...ok, tenant: '.' }],
    ['пробелы по краям', { ...ok, tenant: ' apex-ru ' }],
  ])('отвергает сегмент (%s) — fail-closed', (_label, parts) => {
    expect(() => buildKycObjectKey(parts)).toThrow(InvalidKeySegmentError);
  });
});
