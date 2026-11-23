// Разовое шифрование секретов 2FA операторов (ТД-013).
//
// Запуск внутри контейнера админки (там есть DATABASE_URL и ADMIN_TOTP_KEY):
//   docker exec broker-admin node apps/admin/scripts/encrypt-operator-totp.mjs           — проверка, ничего не пишет
//   docker exec broker-admin node apps/admin/scripts/encrypt-operator-totp.mjs --apply   — шифрует
//
// Печатает только количества, ни секретов, ни логинов. Повторный запуск безопасен:
// уже зашифрованные строки не трогаются. Если хотя бы одна зашифрованная строка не
// расшифровывается этим ключом (ключ подменили), --apply отказывается: иначе в базе
// окажутся секреты под двумя разными ключами.
//
// Формат обязан совпадать с encryptTotpSecret/twoFactorKey из @broker/support
// (проверяется тестом lib/auth/encrypt-operator-totp-script.test.ts). Скрипт написан
// на чистом JS без импорта пакетов монорепо: в собранном образе админки исходников нет.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const PREFIX = 'v1.';

export function deriveKey(raw) {
  const v = (raw ?? '').trim();
  if (v.length < 32) return null;
  return createHash('sha256').update(v, 'utf8').digest();
}

export function sealSecret(secret, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function canOpen(blob, key) {
  const [v, iv, tag, ct] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) return false;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{ connect(): Promise<{ query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>; release(): void }> }} pool
 * @param {{ rawKey: string | undefined; apply: boolean }} opts
 */
export async function run(pool, opts) {
  const key = deriveKey(opts.rawKey);
  if (!key) return { ok: false, reason: 'noKey' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, totp_secret FROM operators WHERE totp_secret IS NOT NULL ORDER BY id FOR UPDATE`,
    );
    const plain = rows.filter((r) => !String(r.totp_secret).startsWith(PREFIX));
    const sealed = rows.filter((r) => String(r.totp_secret).startsWith(PREFIX));
    const foreign = sealed.filter((r) => !canOpen(String(r.totp_secret), key)).length;
    const counts = { total: rows.length, plaintext: plain.length, encrypted: sealed.length, foreignKey: foreign, written: 0 };

    if (!opts.apply || foreign > 0) {
      await client.query('ROLLBACK');
      return foreign > 0 ? { ok: false, reason: 'foreignKey', counts } : { ok: true, dryRun: true, counts };
    }
    for (const r of plain) {
      const res = await client.query(`UPDATE operators SET totp_secret = $1 WHERE id = $2 AND totp_secret = $3`, [
        sealSecret(String(r.totp_secret), key),
        r.id,
        r.totp_secret,
      ]);
      counts.written += res.rowCount ?? 0;
    }
    await client.query('COMMIT');
    return { ok: true, dryRun: false, counts };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.DATABASE_URL) {
    console.error('[encrypt-operator-totp] DATABASE_URL не задан');
    process.exit(2);
  }
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const result = await run(pool, { rawKey: process.env.ADMIN_TOTP_KEY, apply });
    if (!result.ok && result.reason === 'noKey') {
      console.error('[encrypt-operator-totp] ADMIN_TOTP_KEY не задан или короче 32 символов — шифровать нечем. Сгенерировать на сервере: openssl rand -base64 48');
      process.exit(2);
    }
    const c = result.counts;
    console.log(
      `[encrypt-operator-totp] секретов: ${c.total}; открытых: ${c.plaintext}; зашифрованных: ${c.encrypted}; не открываются этим ключом: ${c.foreignKey}; записано: ${c.written}`,
    );
    if (!result.ok) {
      console.error('[encrypt-operator-totp] ОТКАЗ: часть секретов зашифрована другим ключом. Проверьте ADMIN_TOTP_KEY — менять его после включения нельзя.');
      process.exit(3);
    }
    console.log(result.dryRun ? '[encrypt-operator-totp] проверка: ничего не записано. Для записи добавьте --apply' : '[encrypt-operator-totp] готово');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[encrypt-operator-totp] ошибка:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
