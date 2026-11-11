import { readFileSync } from 'node:fs';
import { inTransaction, type PoolLike } from '@broker/money';
import {
  TRANSFER_SYSTEM_OPERATOR,
  keyFingerprint,
  loadSigningKey,
  parseRegistryJson,
  publicKeyPemOf,
  upsertGroupPlatformWithinTx,
} from '@broker/transfer';
import { readEnv } from '@broker/utils';
import { getPool } from '../lib/db';

/**
 * Реестр платформ группы для ячейки (ветка client-transfer) — вызывается
 * скриптом развёртывания ячейки (`platform-new.sh`, шаг «реестр группы») и
 * вручную. Идемпотентно: неизменённые записи не трогает, изменённые пишет с
 * журналом от `system:platform-transfer`.
 *
 *   DATABASE_URL=… SITE_SLUG=nordex-eu PLATFORM_TRANSFER_SIGNING_KEY_PEM_B64=… \
 *     pnpm --filter @broker/admin seed:group-registry ./group-registry.json
 *
 * Формат файла — массив платформ (`slug, name, cabinetUrl, apiUrl,
 * publicKeyPem, euLicense, servedCountries, forbiddenCountries,
 * maxRetailLeverage, bonusesAllowed, acceptsTransfers, legalEntity,
 * regulator`). Для СВОЕЙ платформы (slug = SITE_SLUG) `publicKeyPem` можно
 * не писать: он выводится из приватного ключа ячейки в env.
 *
 *   --print-public-key  — только напечатать публичный ключ ячейки (PEM).
 */
async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const key = loadSigningKey();
  if (args.includes('--print-public-key')) {
    if (!key) {
      console.error('PLATFORM_TRANSFER_SIGNING_KEY_PEM_B64 не задан или не Ed25519');
      return 1;
    }
    console.log(publicKeyPemOf(key));
    return 0;
  }
  const file = args.find((a) => !a.startsWith('--'));
  if (!file || !readEnv(process.env.DATABASE_URL)) {
    console.error('нужны DATABASE_URL и путь к JSON реестра');
    return 2;
  }
  const self = readEnv(process.env.SITE_SLUG);
  const parsed = parseRegistryJson(readFileSync(file, 'utf8'));
  if (!parsed.ok) {
    console.error(`реестр: ${parsed.error}`);
    return 2;
  }
  const pool = getPool() as unknown as PoolLike;
  let failed = 0;
  for (const p of parsed.value) {
    const platform = p.slug === self && !p.publicKeyPem && key ? { ...p, publicKeyPem: publicKeyPemOf(key) } : p;
    const r = await inTransaction(pool, (tx) =>
      upsertGroupPlatformWithinTx(tx, { operatorId: TRANSFER_SYSTEM_OPERATOR, basis: `реестр группы из ${file}`, platform }),
    );
    if (r.ok) console.log(`${p.slug}: ${r.created ? 'добавлена' : 'обновлена'} (ключ ${keyFingerprint(platform.publicKeyPem) ?? '—'})`);
    else if (r.reason === 'noChange') console.log(`${p.slug}: без изменений`);
    else {
      failed++;
      console.error(`${p.slug}: ОШИБКА ${r.reason}${'errors' in r ? ` ${r.errors.join(',')}` : ''}`);
    }
  }
  await (getPool() as unknown as { end(): Promise<void> }).end();
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
