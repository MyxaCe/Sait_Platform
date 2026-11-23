import { decryptTotpSecret, encryptTotpSecret, twoFactorKey } from '@broker/support';

// Секрет TOTP оператора в `operators.totp_secret` (ТД-013).
//
// Форматы:
//   `v1.<iv>.<tag>.<ct>` — AES-256-GCM, ключ из ADMIN_TOTP_KEY (тот же формат и те же
//                          функции, что у секретов клиентов кабинета, CABINET_TOTP_KEY);
//   иначе                — прежний base32 открытым текстом (до ТД-013).
//
// Ключ живёт только в окружении админки, поэтому миграция БД зашифровать строки не
// может. Перевод идёт так: (1) при каждом успешном входе открытый секрет оператора
// перезаписывается зашифрованным; (2) разовый скрипт `scripts/encrypt-operator-totp.mjs`
// при выкате шифрует все оставшиеся строки; (3) после этого ADMIN_TOTP_REQUIRE_ENCRYPTED=1
// запрещает вход по открытому секрету.
//
// Почему без ключа админка не падает на старте: тогда без ключа не войдёт никто, в том
// числе тот, кто должен его задать. Вместо этого вход по уже открытым секретам работает,
// новые подключения 2FA отклоняются, а в лог пишется тревога.

export const ENCRYPTED_PREFIX = 'v1.';

export type OpenedSecret =
  | { ok: true; secret: string; legacy: boolean }
  | { ok: false; reason: 'undecryptable' | 'noKey' | 'plaintextRefused' };

let warnedNoKey = false;

export function adminTotpKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const key = twoFactorKey(env.ADMIN_TOTP_KEY);
  if (!key && !warnedNoKey) {
    warnedNoKey = true;
    console.error(
      '[admin-2fa] ТРЕВОГА: ADMIN_TOTP_KEY не задан или короче 32 символов. Секреты 2FA операторов не шифруются, подключение 2FA новым операторам отклоняется. Сгенерировать на сервере: openssl rand -base64 48',
    );
  }
  return key;
}

export function requireEncrypted(env: Record<string, string | undefined> = process.env): boolean {
  return env.ADMIN_TOTP_REQUIRE_ENCRYPTED === '1';
}

export function isEncryptedSecret(stored: string): boolean {
  return stored.startsWith(ENCRYPTED_PREFIX);
}

export function sealOperatorSecret(secretBase32: string, key: Buffer): string {
  return encryptTotpSecret(secretBase32, key);
}

export function openOperatorSecret(
  stored: string,
  key: Buffer | null,
  opts: { requireEncrypted?: boolean } = {},
): OpenedSecret {
  if (isEncryptedSecret(stored)) {
    if (!key) return { ok: false, reason: 'noKey' };
    const secret = decryptTotpSecret(stored, key);
    return secret === null ? { ok: false, reason: 'undecryptable' } : { ok: true, secret, legacy: false };
  }
  if (opts.requireEncrypted) return { ok: false, reason: 'plaintextRefused' };
  return { ok: true, secret: stored, legacy: true };
}
