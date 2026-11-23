import { describe, expect, it } from 'vitest';
import { decryptTotpSecret, encryptTotpSecret, twoFactorKey } from '@broker/support';
import { canOpen, deriveKey, run, sealSecret } from '../../scripts/encrypt-operator-totp.mjs';

// Скрипт выката (ТД-013) написан на чистом JS без пакетов монорепо. Эти тесты
// держат его формат в точности совместимым с @broker/support.

const RAW = 'r'.repeat(48);
const KEY = twoFactorKey(RAW)!;
const OTHER = twoFactorKey('o'.repeat(48))!;

type Row = { id: string; totp_secret: string | null };

function fakePool(rows: Row[]) {
  const log: string[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      const head = sql.trim().split(/\s+/)[0]!.toUpperCase();
      log.push(head);
      if (head === 'SELECT') return { rows: rows.filter((r) => r.totp_secret !== null).map((r) => ({ ...r })) };
      if (head === 'UPDATE') {
        const [next, id, prev] = params as [string, string, string];
        const row = rows.find((r) => r.id === id && r.totp_secret === prev);
        if (!row) return { rows: [], rowCount: 0 };
        row.totp_secret = next;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    },
    release() {},
  };
  return { pool: { connect: async () => client }, log };
}

describe('encrypt-operator-totp.mjs · совместимость формата', () => {
  it('ключ выводится так же, как twoFactorKey', () => {
    expect(deriveKey(RAW)!.equals(KEY)).toBe(true);
    expect(deriveKey(`  ${RAW}  `)!.equals(KEY)).toBe(true);
    expect(deriveKey('short')).toBeNull();
    expect(deriveKey(undefined)).toBeNull();
  });

  it('то, что шифрует скрипт, расшифровывает @broker/support, и наоборот', () => {
    expect(decryptTotpSecret(sealSecret('JBSWY3DPEHPK3PXP', KEY), KEY)).toBe('JBSWY3DPEHPK3PXP');
    expect(canOpen(encryptTotpSecret('JBSWY3DPEHPK3PXP', KEY), KEY)).toBe(true);
    expect(canOpen(encryptTotpSecret('JBSWY3DPEHPK3PXP', OTHER), KEY)).toBe(false);
  });
});

describe('encrypt-operator-totp.mjs · run', () => {
  it('по умолчанию проверка: считает и ничего не пишет', async () => {
    const rows: Row[] = [
      { id: '1', totp_secret: 'AAAABBBBCCCCDDDD' },
      { id: '2', totp_secret: encryptTotpSecret('EEEEFFFFGGGGHHHH', KEY) },
      { id: '3', totp_secret: null },
    ];
    const { pool, log } = fakePool(rows);
    const res = await run(pool, { rawKey: RAW, apply: false });
    expect(res).toMatchObject({
      ok: true,
      dryRun: true,
      counts: { total: 2, plaintext: 1, encrypted: 1, foreignKey: 0, written: 0 },
    });
    expect(rows[0]!.totp_secret).toBe('AAAABBBBCCCCDDDD');
    expect(log).toContain('ROLLBACK');
    expect(log).not.toContain('UPDATE');
  });

  it('--apply шифрует открытые, зашифрованные не трогает; повторный запуск ничего не пишет', async () => {
    const enc = encryptTotpSecret('EEEEFFFFGGGGHHHH', KEY);
    const rows: Row[] = [
      { id: '1', totp_secret: 'AAAABBBBCCCCDDDD' },
      { id: '2', totp_secret: enc },
    ];
    const { pool } = fakePool(rows);
    const first = await run(pool, { rawKey: RAW, apply: true });
    expect(first).toMatchObject({ ok: true, dryRun: false, counts: { plaintext: 1, written: 1 } });
    expect(decryptTotpSecret(rows[0]!.totp_secret!, KEY)).toBe('AAAABBBBCCCCDDDD');
    expect(rows[1]!.totp_secret).toBe(enc);

    const second = await run(pool, { rawKey: RAW, apply: true });
    expect(second).toMatchObject({ ok: true, counts: { plaintext: 0, encrypted: 2, written: 0 } });
  });

  it('есть секрет под другим ключом → --apply отказывается, ничего не пишет', async () => {
    const rows: Row[] = [
      { id: '1', totp_secret: 'AAAABBBBCCCCDDDD' },
      { id: '2', totp_secret: encryptTotpSecret('EEEEFFFFGGGGHHHH', OTHER) },
    ];
    const { pool, log } = fakePool(rows);
    const res = await run(pool, { rawKey: RAW, apply: true });
    expect(res).toMatchObject({ ok: false, reason: 'foreignKey', counts: { foreignKey: 1, written: 0 } });
    expect(rows[0]!.totp_secret).toBe('AAAABBBBCCCCDDDD');
    expect(log).not.toContain('UPDATE');
  });

  it('без ключа → отказ, к базе не обращается', async () => {
    const { pool, log } = fakePool([{ id: '1', totp_secret: 'AAAABBBBCCCCDDDD' }]);
    expect(await run(pool, { rawKey: '', apply: true })).toEqual({ ok: false, reason: 'noKey' });
    expect(log).toHaveLength(0);
  });
});
