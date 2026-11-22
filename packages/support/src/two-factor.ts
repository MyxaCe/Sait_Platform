import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';
import { appendJournalWithinTx, inTransaction, rollback, SYSTEM_OPERATORS, type PoolLike, type Queryable } from '@broker/money';
import { enqueueMail } from './outbound';
import { firstNameOf, mailLocale } from './text';
import { generateTotpSecret, matchTotpCounter } from './totp';

export const TWO_FACTOR_ACTIONS = {
  enabled: 'auth.two_factor.enabled',
  disabled: 'auth.two_factor.disabled',
  recoveryRegenerated: 'auth.two_factor.recovery_regenerated',
  recoveryUsed: 'auth.two_factor.recovery_used',
  locked: 'auth.two_factor.locked',
} as const;

export const RECOVERY_CODE_COUNT = 10;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
export const ENROLL_TTL_MINUTES = 15;
export const LOGIN_CHALLENGE_TTL_MINUTES = 5;
export const CHALLENGE_MAX_ATTEMPTS = 5;

export function twoFactorKey(raw: string | null | undefined): Buffer | null {
  const v = (raw ?? '').trim();
  if (v.length < 32) return null;
  return createHash('sha256').update(v, 'utf8').digest();
}

export function encryptTotpSecret(secret: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptTotpSecret(blob: string, key: Buffer): string | null {
  const [v, iv, tag, ct] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const out = new Set<string>();
  while (out.size < count) {
    let s = '';
    for (let i = 0; i < 10; i++) s += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    out.add(`${s.slice(0, 5)}-${s.slice(5)}`);
  }
  return [...out];
}

export function normalizeRecoveryCode(input: string): string {
  return input.toLowerCase().replace(/[\s-]+/gu, '');
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code), 'utf8').digest('hex');
}

function looksLikeTotp(code: string): boolean {
  return /^\d{6}$/u.test(code.replace(/\s+/gu, ''));
}

export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: Date | null;
  recoveryLeft: number;
  lockedUntil: Date | null;
}

export async function getTwoFactorStatus(db: Queryable, userId: string): Promise<TwoFactorStatus> {
  const r = await db.query(
    `SELECT t.enabled_at, t.locked_until,
            (SELECT count(*)::int FROM client_totp_recovery_codes c WHERE c.user_id = t.user_id AND c.used_at IS NULL) AS left
       FROM client_totp t WHERE t.user_id = $1`,
    [userId],
  );
  const row = r.rows[0];
  if (!row || !row.enabled_at) return { enabled: false, enabledAt: null, recoveryLeft: 0, lockedUntil: null };
  return {
    enabled: true,
    enabledAt: new Date(row.enabled_at as string),
    recoveryLeft: Number(row.left ?? 0),
    lockedUntil: row.locked_until ? new Date(row.locked_until as string) : null,
  };
}

export async function isTwoFactorEnabled(db: Queryable, userId: string): Promise<boolean> {
  const r = await db.query(`SELECT 1 FROM client_totp WHERE user_id = $1 AND enabled_at IS NOT NULL`, [userId]);
  return r.rows.length > 0;
}

export type CodeCheck =
  | { ok: true; method: 'totp' | 'recovery' }
  | { ok: false; reason: 'notEnabled' | 'invalidCode' | 'locked' | 'unavailable'; lockedUntil?: Date };

async function registerFailure(tx: Queryable, userId: string, attempts: number, now: Date): Promise<CodeCheck> {
  if (attempts + 1 >= MAX_FAILED_ATTEMPTS) {
    const until = new Date(now.getTime() + LOCK_MINUTES * 60_000);
    await tx.query(`UPDATE client_totp SET failed_attempts = 0, locked_until = $2 WHERE user_id = $1`, [userId, until]);
    await journal(tx, TWO_FACTOR_ACTIONS.locked, userId, { until: until.toISOString(), minutes: LOCK_MINUTES });
    return { ok: false, reason: 'locked', lockedUntil: until };
  }
  await tx.query(`UPDATE client_totp SET failed_attempts = failed_attempts + 1 WHERE user_id = $1`, [userId]);
  return { ok: false, reason: 'invalidCode' };
}

export async function checkSecondFactorTx(
  tx: Queryable,
  input: { userId: string; code: string; key: Buffer | null; now: Date; allowRecovery?: boolean; pending?: boolean },
): Promise<CodeCheck> {
  const r = await tx.query(
    `SELECT secret_enc, enabled_at, created_at, last_counter, failed_attempts, locked_until
       FROM client_totp WHERE user_id = $1 FOR UPDATE`,
    [input.userId],
  );
  const row = r.rows[0];
  if (!row) return { ok: false, reason: 'notEnabled' };
  if (input.pending ? row.enabled_at : !row.enabled_at) return { ok: false, reason: 'notEnabled' };
  if (row.locked_until && new Date(row.locked_until as string) > input.now) {
    return { ok: false, reason: 'locked', lockedUntil: new Date(row.locked_until as string) };
  }
  if (!input.key) return { ok: false, reason: 'unavailable' };
  const secret = decryptTotpSecret(String(row.secret_enc), input.key);
  if (!secret) {
    console.error(`[2fa] секрет клиента ${input.userId} не расшифровывается — проверьте CABINET_TOTP_KEY`);
    return { ok: false, reason: 'unavailable' };
  }
  const attempts = Number(row.failed_attempts ?? 0);
  const code = input.code.trim();

  if (looksLikeTotp(code)) {
    const counter = matchTotpCounter(secret, code, {}, input.now.getTime());
    const last = row.last_counter === null || row.last_counter === undefined ? null : Number(row.last_counter);
    if (counter !== null && (last === null || counter > last)) {
      await tx.query(
        `UPDATE client_totp SET last_counter = $2, failed_attempts = 0, locked_until = NULL WHERE user_id = $1`,
        [input.userId, counter],
      );
      return { ok: true, method: 'totp' };
    }
    return registerFailure(tx, input.userId, attempts, input.now);
  }

  if (input.allowRecovery !== false && !input.pending && normalizeRecoveryCode(code).length === 10) {
    const used = await tx.query(
      `UPDATE client_totp_recovery_codes SET used_at = $3
        WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id`,
      [input.userId, hashRecoveryCode(code), input.now],
    );
    if (used.rows.length > 0) {
      await tx.query(`UPDATE client_totp SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1`, [input.userId]);
      const left = await tx.query(
        `SELECT count(*)::int AS n FROM client_totp_recovery_codes WHERE user_id = $1 AND used_at IS NULL`,
        [input.userId],
      );
      await journal(tx, TWO_FACTOR_ACTIONS.recoveryUsed, input.userId, { left: Number(left.rows[0]?.n ?? 0) });
      return { ok: true, method: 'recovery' };
    }
  }
  return registerFailure(tx, input.userId, attempts, input.now);
}

export async function checkSecondFactor(
  pool: PoolLike,
  input: { userId: string; code: string; key: Buffer | null; now?: Date; allowRecovery?: boolean },
): Promise<CodeCheck> {
  return inTransaction<CodeCheck>(pool, (tx) => checkSecondFactorTx(tx, { ...input, now: input.now ?? new Date() }));
}

function journal(tx: Queryable, action: string, userId: string, payload: Record<string, unknown>) {
  return appendJournalWithinTx(
    { operatorId: SYSTEM_OPERATORS.cabinet, action, subjectKind: 'client', subjectId: userId, payload },
    tx,
  );
}

async function storeRecoveryCodes(tx: Queryable, userId: string, now: Date): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await tx.query(`DELETE FROM client_totp_recovery_codes WHERE user_id = $1`, [userId]);
  for (const c of codes) {
    await tx.query(
      `INSERT INTO client_totp_recovery_codes (user_id, code_hash, created_at) VALUES ($1, $2, $3)`,
      [userId, hashRecoveryCode(c), now],
    );
  }
  return codes;
}

export type BeginEnrollResult = { ok: true; secret: string } | { ok: false; reason: 'alreadyEnabled' | 'unavailable' };

export async function beginTwoFactorEnrollment(
  db: Queryable,
  input: { userId: string; key: Buffer | null; now?: Date },
): Promise<BeginEnrollResult> {
  if (!input.key) return { ok: false, reason: 'unavailable' };
  const now = input.now ?? new Date();
  const secret = generateTotpSecret();
  const r = await db.query(
    `INSERT INTO client_totp (user_id, secret_enc, created_at) VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET secret_enc = EXCLUDED.secret_enc, created_at = EXCLUDED.created_at, last_counter = NULL,
           failed_attempts = CASE WHEN client_totp.locked_until > EXCLUDED.created_at THEN client_totp.failed_attempts ELSE 0 END
     WHERE client_totp.enabled_at IS NULL
     RETURNING user_id`,
    [input.userId, encryptTotpSecret(secret, input.key), now],
  );
  if (r.rows.length === 0) return { ok: false, reason: 'alreadyEnabled' };
  return { ok: true, secret };
}

export type ConfirmEnrollResult =
  | { ok: true; recoveryCodes: string[] }
  | { ok: false; reason: 'expired' | 'invalidCode' | 'locked' | 'unavailable' | 'notEnabled'; lockedUntil?: Date };

export async function confirmTwoFactorEnrollment(
  pool: PoolLike,
  input: { userId: string; code: string; key: Buffer | null; now?: Date },
): Promise<ConfirmEnrollResult> {
  const now = input.now ?? new Date();
  return inTransaction<ConfirmEnrollResult>(pool, async (tx) => {
    const p = await tx.query(`SELECT created_at, enabled_at FROM client_totp WHERE user_id = $1 FOR UPDATE`, [input.userId]);
    const row = p.rows[0];
    if (!row || row.enabled_at) return rollback<ConfirmEnrollResult>({ ok: false, reason: 'expired' });
    if (new Date(row.created_at as string).getTime() + ENROLL_TTL_MINUTES * 60_000 < now.getTime()) {
      return rollback<ConfirmEnrollResult>({ ok: false, reason: 'expired' });
    }
    const check = await checkSecondFactorTx(tx, { userId: input.userId, code: input.code, key: input.key, now, pending: true });
    if (!check.ok) return check;
    await tx.query(`UPDATE client_totp SET enabled_at = $2 WHERE user_id = $1`, [input.userId, now]);
    const codes = await storeRecoveryCodes(tx, input.userId, now);
    await journal(tx, TWO_FACTOR_ACTIONS.enabled, input.userId, { recoveryCodes: codes.length });
    await enqueueTwoFactorNotice(tx, input.userId, 'enabled', null);
    return { ok: true, recoveryCodes: codes };
  });
}

export type DisableResult = { ok: true } | Exclude<CodeCheck, { ok: true }>;

export async function disableTwoFactor(
  pool: PoolLike,
  input: { userId: string; code: string; key: Buffer | null; now?: Date },
): Promise<DisableResult> {
  const now = input.now ?? new Date();
  return inTransaction<DisableResult>(pool, async (tx) => {
    const check = await checkSecondFactorTx(tx, { ...input, now });
    if (!check.ok) return check;
    await clearTwoFactorTx(tx, input.userId);
    await journal(tx, TWO_FACTOR_ACTIONS.disabled, input.userId, { method: check.method });
    await enqueueTwoFactorNotice(tx, input.userId, 'disabled', null);
    return { ok: true };
  });
}

export type RegenerateResult = { ok: true; recoveryCodes: string[] } | Exclude<CodeCheck, { ok: true }>;

export async function regenerateRecoveryCodes(
  pool: PoolLike,
  input: { userId: string; code: string; key: Buffer | null; now?: Date },
): Promise<RegenerateResult> {
  const now = input.now ?? new Date();
  return inTransaction<RegenerateResult>(pool, async (tx) => {
    const check = await checkSecondFactorTx(tx, { ...input, now, allowRecovery: false });
    if (!check.ok) return check;
    const codes = await storeRecoveryCodes(tx, input.userId, now);
    await journal(tx, TWO_FACTOR_ACTIONS.recoveryRegenerated, input.userId, { recoveryCodes: codes.length });
    return { ok: true, recoveryCodes: codes };
  });
}

export async function clearTwoFactorTx(tx: Queryable, userId: string): Promise<boolean> {
  const r = await tx.query(`DELETE FROM client_totp WHERE user_id = $1 RETURNING enabled_at`, [userId]);
  await tx.query(`DELETE FROM client_totp_recovery_codes WHERE user_id = $1`, [userId]);
  await tx.query(`DELETE FROM client_login_challenges WHERE user_id = $1`, [userId]);
  return r.rows.some((row) => row.enabled_at !== null && row.enabled_at !== undefined);
}

function challengeHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function createLoginChallenge(db: Queryable, userId: string, now: Date = new Date()): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query(`DELETE FROM client_login_challenges WHERE user_id = $1 AND expires_at <= $2`, [userId, now]);
  await db.query(
    `INSERT INTO client_login_challenges (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)`,
    [challengeHash(token), userId, now, new Date(now.getTime() + LOGIN_CHALLENGE_TTL_MINUTES * 60_000)],
  );
  return token;
}

export type ChallengeResult =
  | { ok: true; userId: string; method: 'totp' | 'recovery' }
  | { ok: false; reason: 'expired' | 'invalidCode' | 'locked' | 'unavailable'; lockedUntil?: Date };

export async function completeLoginChallenge(
  pool: PoolLike,
  input: { token: string | null | undefined; code: string; key: Buffer | null; now?: Date },
): Promise<ChallengeResult> {
  const now = input.now ?? new Date();
  if (!input.token) return { ok: false, reason: 'expired' };
  const hash = challengeHash(input.token);
  return inTransaction<ChallengeResult>(pool, async (tx) => {
    const c = await tx.query(
      `SELECT user_id, attempts FROM client_login_challenges WHERE token_hash = $1 AND expires_at > $2 FOR UPDATE`,
      [hash, now],
    );
    const row = c.rows[0];
    if (!row || Number(row.attempts) >= CHALLENGE_MAX_ATTEMPTS) {
      await tx.query(`DELETE FROM client_login_challenges WHERE token_hash = $1`, [hash]);
      return { ok: false, reason: 'expired' };
    }
    const userId = String(row.user_id);
    const check = await checkSecondFactorTx(tx, { userId, code: input.code, key: input.key, now });
    if (check.ok) {
      await tx.query(`DELETE FROM client_login_challenges WHERE token_hash = $1`, [hash]);
      return { ok: true, userId, method: check.method };
    }
    if (check.reason === 'notEnabled') {
      await tx.query(`DELETE FROM client_login_challenges WHERE token_hash = $1`, [hash]);
      return { ok: false, reason: 'expired' };
    }
    await tx.query(`UPDATE client_login_challenges SET attempts = attempts + 1 WHERE token_hash = $1`, [hash]);
    return { ok: false, reason: check.reason, lockedUntil: check.lockedUntil };
  });
}

export type TwoFactorNoticeKind = 'enabled' | 'disabled' | 'reset';

export function twoFactorNotice(
  kind: TwoFactorNoticeKind,
  input: { locale: string; firstName: string; ticket?: string | null },
): { subject: string; body: string } {
  const en = mailLocale(input.locale) === 'en';
  const hello = en
    ? input.firstName ? `Hello, ${input.firstName}!` : 'Hello!'
    : input.firstName ? `Здравствуйте, ${input.firstName}!` : 'Здравствуйте!';
  const ticket = input.ticket ? (en ? `Support request: #${input.ticket}.` : `Обращение в поддержку: №${input.ticket}.`) : null;
  const notMe = en
    ? 'If it was not you, contact support right away by replying to this email.'
    : 'Если это были не вы — сразу свяжитесь с поддержкой, ответив на это письмо.';
  const text = en
    ? {
        enabled: ['Two-factor authentication has been enabled', 'Two-factor authentication has been enabled for your account. From now on, signing in and sensitive actions require a code from your authenticator app.'],
        disabled: ['Two-factor authentication has been disabled', 'Two-factor authentication has been disabled for your account. Signing in now requires only your password.'],
        reset: ['Two-factor authentication has been reset', 'At your request, our staff has reset two-factor authentication for your account. You can sign in with your password and set it up again in Profile → Security.'],
      }[kind]
    : {
        enabled: ['Двухфакторная защита включена', 'Для вашего аккаунта включена двухфакторная защита. Теперь вход и важные действия требуют код из приложения-аутентификатора.'],
        disabled: ['Двухфакторная защита отключена', 'Для вашего аккаунта отключена двухфакторная защита. Теперь для входа достаточно пароля.'],
        reset: ['Двухфакторная защита сброшена', 'По вашему обращению сотрудник сбросил двухфакторную защиту аккаунта. Войдите по паролю и при желании включите её снова в разделе «Профиль → Безопасность».'],
      }[kind];
  return {
    subject: text[0]!,
    body: [hello, '', text[1]!, '', ...(ticket ? [ticket] : []), notMe].join('\n'),
  };
}

export async function enqueueTwoFactorNotice(
  tx: Queryable,
  userId: string,
  kind: TwoFactorNoticeKind,
  ticket: string | null,
): Promise<void> {
  const u = await tx.query(`SELECT email, full_name, locale FROM users WHERE id = $1`, [userId]);
  const row = u.rows[0];
  if (!row) return;
  const n = twoFactorNotice(kind, { locale: String(row.locale ?? 'ru'), firstName: firstNameOf(String(row.full_name ?? '')), ticket });
  await enqueueMail(tx, { purpose: 'credentials_notice', to: String(row.email), subject: n.subject, bodyText: n.body });
}
