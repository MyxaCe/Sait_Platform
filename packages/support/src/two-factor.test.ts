import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, seedUser, type TestDb } from './testing/pg';
import { generateTotp } from './totp';
import {
  beginTwoFactorEnrollment,
  checkSecondFactor,
  completeLoginChallenge,
  confirmTwoFactorEnrollment,
  createLoginChallenge,
  decryptTotpSecret,
  disableTwoFactor,
  encryptTotpSecret,
  generateRecoveryCodes,
  getTwoFactorStatus,
  hashRecoveryCode,
  isTwoFactorEnabled,
  MAX_FAILED_ATTEMPTS,
  RECOVERY_CODE_COUNT,
  regenerateRecoveryCodes,
  twoFactorKey,
  twoFactorNotice,
} from './two-factor';

const KEY = twoFactorKey('k'.repeat(48))!;
const T0 = new Date('2026-11-22T10:00:00Z');
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);

let db: TestDb;
let userId: string;

beforeEach(async () => {
  db = await createTestDb();
  userId = await seedUser(db, { email: 'anna@client.test', name: 'Анна Клиентова' });
});
afterEach(async () => db.close());

async function enable(): Promise<{ secret: string; codes: string[] }> {
  const b = await beginTwoFactorEnrollment(db, { userId, key: KEY, now: T0 });
  if (!b.ok) throw new Error(b.reason);
  const c = await confirmTwoFactorEnrollment(db, { userId, code: generateTotp(b.secret, {}, T0.getTime()), key: KEY, now: T0 });
  if (!c.ok) throw new Error(c.reason);
  return { secret: b.secret, codes: c.recoveryCodes };
}

async function mails() {
  return (await db.query(`SELECT purpose, to_address, subject FROM outbound_mail ORDER BY created_at`)).rows;
}

async function actions() {
  return (await db.query(`SELECT action FROM admin_action_journal WHERE subject_id = $1 ORDER BY seq`, [userId])).rows.map((r) => r.action);
}

describe('шифрование секрета и резервные коды', () => {
  it('секрет шифруется AES-GCM и не читается чужим ключом', () => {
    const blob = encryptTotpSecret('JBSWY3DPEHPK3PXP', KEY);
    expect(blob).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptTotpSecret(blob, KEY)).toBe('JBSWY3DPEHPK3PXP');
    expect(decryptTotpSecret(blob, twoFactorKey('z'.repeat(48))!)).toBeNull();
  });

  it('короткий или пустой ключ — 2FA недоступна', () => {
    expect(twoFactorKey('')).toBeNull();
    expect(twoFactorKey('short')).toBeNull();
  });

  it('10 уникальных кодов вида xxxxx-xxxxx; хэш не зависит от регистра и дефиса', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    expect(hashRecoveryCode(codes[0]!)).toBe(hashRecoveryCode(codes[0]!.toUpperCase().replace('-', ' ')));
  });
});

describe('включение 2FA', () => {
  it('неподтверждённый секрет 2FA не включает; подтверждение верным кодом включает, коды хранятся хэшами', async () => {
    const b = await beginTwoFactorEnrollment(db, { userId, key: KEY, now: T0 });
    expect(b.ok).toBe(true);
    expect(await isTwoFactorEnabled(db, userId)).toBe(false);
    const stored = (await db.query(`SELECT secret_enc FROM client_totp WHERE user_id = $1`, [userId])).rows[0]!.secret_enc;
    expect(String(stored)).not.toContain(b.ok ? b.secret : '');

    expect(await confirmTwoFactorEnrollment(db, { userId, code: '000000', key: KEY, now: T0 })).toEqual({ ok: false, reason: 'invalidCode' });
    const c = await confirmTwoFactorEnrollment(db, { userId, code: generateTotp(b.ok ? b.secret : '', {}, T0.getTime()), key: KEY, now: T0 });
    expect(c.ok).toBe(true);
    const codes = c.ok ? c.recoveryCodes : [];
    const hashes = (await db.query(`SELECT code_hash FROM client_totp_recovery_codes WHERE user_id = $1`, [userId])).rows.map((r) => r.code_hash);
    expect(hashes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(hashes).not.toContain(codes[0]);
    expect(hashes).toContain(hashRecoveryCode(codes[0]!));
    expect(await getTwoFactorStatus(db, userId)).toMatchObject({ enabled: true, recoveryLeft: RECOVERY_CODE_COUNT });
    expect(await actions()).toContain('auth.two_factor.enabled');
    expect(await mails()).toEqual([
      { purpose: 'credentials_notice', to_address: 'anna@client.test', subject: 'Двухфакторная защита включена' },
    ]);
  });

  it('подтверждение после 15 минут — истекло; повторное включение при включённой — отказ', async () => {
    const b = await beginTwoFactorEnrollment(db, { userId, key: KEY, now: T0 });
    const late = at(16 * 60);
    expect(await confirmTwoFactorEnrollment(db, { userId, code: generateTotp(b.ok ? b.secret : '', {}, late.getTime()), key: KEY, now: late })).toEqual({ ok: false, reason: 'expired' });
    await db.query(`DELETE FROM client_totp`);
    await enable();
    expect(await beginTwoFactorEnrollment(db, { userId, key: KEY, now: T0 })).toEqual({ ok: false, reason: 'alreadyEnabled' });
  });

  it('без ключа шифрования включить нельзя', async () => {
    expect(await beginTwoFactorEnrollment(db, { userId, key: null })).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('проверка кода', () => {
  it('без 2FA — notEnabled', async () => {
    expect(await checkSecondFactor(db, { userId, code: '123456', key: KEY, now: T0 })).toEqual({ ok: false, reason: 'notEnabled' });
  });

  it('TOTP принимается один раз (повтор того же кода отклоняется)', async () => {
    const { secret } = await enable();
    const code = generateTotp(secret, {}, at(30).getTime());
    expect(await checkSecondFactor(db, { userId, code, key: KEY, now: at(30) })).toEqual({ ok: true, method: 'totp' });
    expect(await checkSecondFactor(db, { userId, code, key: KEY, now: at(31) })).toEqual({ ok: false, reason: 'invalidCode' });
  });

  it('резервный код — одноразовый', async () => {
    const { codes } = await enable();
    expect(await checkSecondFactor(db, { userId, code: codes[3]!.toUpperCase(), key: KEY, now: at(60) })).toEqual({ ok: true, method: 'recovery' });
    expect(await checkSecondFactor(db, { userId, code: codes[3]!, key: KEY, now: at(61) })).toEqual({ ok: false, reason: 'invalidCode' });
    expect((await getTwoFactorStatus(db, userId)).recoveryLeft).toBe(RECOVERY_CODE_COUNT - 1);
    expect(await actions()).toContain('auth.two_factor.recovery_used');
  });

  it(`${MAX_FAILED_ATTEMPTS} неверных кодов — блокировка на 15 минут, даже верный код не проходит; после — снова можно`, async () => {
    const { secret } = await enable();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
      expect(await checkSecondFactor(db, { userId, code: '000000', key: KEY, now: at(60 + i) })).toEqual({ ok: false, reason: 'invalidCode' });
    }
    const locked = await checkSecondFactor(db, { userId, code: '000000', key: KEY, now: at(70) });
    expect(locked).toMatchObject({ ok: false, reason: 'locked' });
    expect(await checkSecondFactor(db, { userId, code: generateTotp(secret, {}, at(100).getTime()), key: KEY, now: at(100) })).toMatchObject({ ok: false, reason: 'locked' });
    expect(await actions()).toContain('auth.two_factor.locked');
    const later = at(70 + 15 * 60 + 1);
    expect(await checkSecondFactor(db, { userId, code: generateTotp(secret, {}, later.getTime()), key: KEY, now: later })).toEqual({ ok: true, method: 'totp' });
  });
});

describe('вход со вторым шагом', () => {
  it('верный код закрывает тикет и отдаёт userId; тикет одноразовый', async () => {
    const { secret } = await enable();
    const token = await createLoginChallenge(db, userId, at(30));
    const r = await completeLoginChallenge(db, { token, code: generateTotp(secret, {}, at(40).getTime()), key: KEY, now: at(40) });
    expect(r).toEqual({ ok: true, userId, method: 'totp' });
    expect(await completeLoginChallenge(db, { token, code: generateTotp(secret, {}, at(70).getTime()), key: KEY, now: at(70) })).toEqual({ ok: false, reason: 'expired' });
  });

  it('просроченный или чужой тикет — expired; без тикета — expired', async () => {
    const { secret } = await enable();
    const token = await createLoginChallenge(db, userId, at(0));
    const late = at(6 * 60);
    expect(await completeLoginChallenge(db, { token, code: generateTotp(secret, {}, late.getTime()), key: KEY, now: late })).toEqual({ ok: false, reason: 'expired' });
    expect(await completeLoginChallenge(db, { token: 'forged', code: '123456', key: KEY, now: T0 })).toEqual({ ok: false, reason: 'expired' });
    expect(await completeLoginChallenge(db, { token: null, code: '123456', key: KEY, now: T0 })).toEqual({ ok: false, reason: 'expired' });
  });

  it('перебор кодов на входе блокирует 2FA', async () => {
    await enable();
    const token = await createLoginChallenge(db, userId, at(0));
    const results = [];
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      results.push((await completeLoginChallenge(db, { token, code: '111111', key: KEY, now: at(10 + i) })) as { reason?: string });
    }
    expect(results.map((r) => r.reason)).toEqual(['invalidCode', 'invalidCode', 'invalidCode', 'invalidCode', 'locked']);
  });
});

describe('отключение и перевыпуск кодов', () => {
  it('отключение требует код; после — 2FA выключена, письмо клиенту', async () => {
    const { secret } = await enable();
    expect(await disableTwoFactor(db, { userId, code: '000000', key: KEY, now: at(60) })).toEqual({ ok: false, reason: 'invalidCode' });
    expect(await isTwoFactorEnabled(db, userId)).toBe(true);
    expect(await disableTwoFactor(db, { userId, code: generateTotp(secret, {}, at(60).getTime()), key: KEY, now: at(60) })).toEqual({ ok: true });
    expect(await isTwoFactorEnabled(db, userId)).toBe(false);
    expect((await db.query(`SELECT count(*)::int AS n FROM client_totp_recovery_codes`)).rows[0]!.n).toBe(0);
    expect((await mails()).map((m) => m.subject)).toEqual(['Двухфакторная защита включена', 'Двухфакторная защита отключена']);
    expect(await actions()).toContain('auth.two_factor.disabled');
  });

  it('перевыпуск: старые коды перестают работать, новые — работают; резервным кодом перевыпуск не делается', async () => {
    const { secret, codes } = await enable();
    expect(await regenerateRecoveryCodes(db, { userId, code: codes[0]!, key: KEY, now: at(60) })).toEqual({ ok: false, reason: 'invalidCode' });
    const r = await regenerateRecoveryCodes(db, { userId, code: generateTotp(secret, {}, at(60).getTime()), key: KEY, now: at(60) });
    expect(r.ok).toBe(true);
    const fresh = r.ok ? r.recoveryCodes : [];
    expect(await checkSecondFactor(db, { userId, code: codes[1]!, key: KEY, now: at(90) })).toEqual({ ok: false, reason: 'invalidCode' });
    expect(await checkSecondFactor(db, { userId, code: fresh[0]!, key: KEY, now: at(91) })).toEqual({ ok: true, method: 'recovery' });
  });
});

describe('письма', () => {
  it('ru и en; de/fr/es — по-английски, как остальные служебные письма', () => {
    expect(twoFactorNotice('reset', { locale: 'ru', firstName: 'Анна', ticket: '42' }).body).toContain('№42');
    expect(twoFactorNotice('enabled', { locale: 'en', firstName: 'Ann' }).subject).toBe('Two-factor authentication has been enabled');
    expect(twoFactorNotice('disabled', { locale: 'de', firstName: '' }).subject).toBe('Two-factor authentication has been disabled');
  });
});
