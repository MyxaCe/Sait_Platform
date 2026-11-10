import { randomInt } from 'node:crypto';
import { appendJournalSeqWithinTx, isUniqueViolation, type Queryable } from '@broker/money';
import { SYSTEM_OPERATORS } from '@broker/money';
import { REFERRAL_ACTIONS } from './actions';
import { isMeaningfulIp, normalizeEmail } from './antifraud';
import type { ResolvedAttribution } from './attribution';

/**
 * Атрибуция в базе: реф-коды и запись «кто привёл» при регистрации.
 */

/** Алфавит кода без похожих символов (0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE_LENGTH = 8;

export function generateReferralCode(rand: (max: number) => number = randomInt): string {
  let s = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) s += CODE_ALPHABET[rand(CODE_ALPHABET.length)];
  return s;
}

/** Реф-код клиента; создаётся лениво (первое открытие «Пригласи друга»). */
export async function ensureReferralCode(db: Queryable, userId: string): Promise<string> {
  const cur = await db.query(`SELECT code FROM referral_codes WHERE user_id::text = $1`, [userId]);
  if (cur.rows[0]) return String(cur.rows[0].code);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateReferralCode();
    try {
      const ins = await db.query(
        `INSERT INTO referral_codes (user_id, code) VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING RETURNING code`,
        [userId, code],
      );
      if (ins.rows[0]) return String(ins.rows[0].code);
      const again = await db.query(`SELECT code FROM referral_codes WHERE user_id::text = $1`, [userId]);
      if (again.rows[0]) return String(again.rows[0].code);
    } catch (e) {
      if (!isUniqueViolation(e, 'referral_codes_code_uniq')) throw e;
    }
  }
  throw new Error('не удалось выдать уникальный реф-код');
}

export type SelfReferralReason = 'same_ip' | 'same_email';

export type AttributionOutcome =
  | { state: 'none' }
  | { state: 'unknown_code'; code: string }
  | { state: 'attributed'; referrerUserId: string; ibPartnerId: string | null }
  | { state: 'rejected'; referrerUserId: string; reason: SelfReferralReason };

/**
 * Записать атрибуцию нового клиента ВНУТРИ транзакции регистрации.
 *
 * Самореферал отсекается: реферер с тем же IP регистрации/сессий или тем же
 * email (с точностью до +метки и точек gmail) — атрибуция `rejected` с
 * причиной (строка для аудита, наград по ней не будет). Неизвестный код —
 * ничего не пишем (опечатка в ссылке не должна ломать регистрацию).
 * Слаг акции (`?promo=`) сохраняется всегда — это источник клиента.
 */
export async function recordAttributionWithinTx(
  tx: Queryable,
  input: {
    refereeUserId: string;
    refereeEmail: string;
    ip: string | null;
    resolved: ResolvedAttribution;
  },
): Promise<AttributionOutcome> {
  const { ref, promo } = input.resolved;
  if (!ref && !promo) return { state: 'none' };

  let referrer: { id: string; email: string; ip: string | null } | null = null;
  if (ref) {
    const r = await tx.query(
      `SELECT u.id::text AS id, u.email, u.registration_ip
         FROM referral_codes rc JOIN users u ON u.id = rc.user_id
        WHERE rc.code = $1`,
      [ref.value],
    );
    const row = r.rows[0];
    if (row) referrer = { id: String(row.id), email: String(row.email), ip: (row.registration_ip as string | null) ?? null };
  }

  if (!referrer) {
    if (promo) {
      await tx.query(
        `INSERT INTO referral_attributions (referee_user_id, promo_slug, source, status, first_click_at, ip)
         VALUES ($1, $2, $3, 'active', $4, $5) ON CONFLICT (referee_user_id) DO NOTHING`,
        [input.refereeUserId, promo.value, promo.source, promo.firstClickAt.toISOString(), input.ip],
      );
    }
    return ref ? { state: 'unknown_code', code: ref.value } : { state: 'none' };
  }

  let self: SelfReferralReason | null = null;
  if (referrer.id === input.refereeUserId) self = 'same_email';
  else if (normalizeEmail(referrer.email) === normalizeEmail(input.refereeEmail)) self = 'same_email';
  else if (isMeaningfulIp(input.ip)) {
    const sameIp = await tx.query(
      `SELECT 1 FROM users WHERE id::text = $1 AND registration_ip = $2
       UNION ALL
       SELECT 1 FROM sessions WHERE user_id::text = $1 AND ip = $2
       LIMIT 1`,
      [referrer.id, input.ip],
    );
    if (sameIp.rows.length > 0) self = 'same_ip';
  }

  const ib = await tx.query(
    `SELECT id::text AS id FROM ib_partners WHERE user_id::text = $1 AND status = 'active'`,
    [referrer.id],
  );
  const ibPartnerId = self ? null : ((ib.rows[0]?.id as string | undefined) ?? null);

  await tx.query(
    `INSERT INTO referral_attributions
       (referee_user_id, referrer_user_id, ib_partner_id, code, promo_slug, source, status, reject_reason,
        first_click_at, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (referee_user_id) DO NOTHING`,
    [
      input.refereeUserId,
      referrer.id,
      ibPartnerId,
      ref!.value,
      promo?.value ?? null,
      ref!.source,
      self ? 'rejected' : 'active',
      self,
      ref!.firstClickAt.toISOString(),
      input.ip,
    ],
  );
  const seq = await appendJournalSeqWithinTx(
    {
      operatorId: SYSTEM_OPERATORS.cabinet,
      action: self ? REFERRAL_ACTIONS.rejected : REFERRAL_ACTIONS.attributed,
      subjectKind: 'client',
      subjectId: input.refereeUserId,
      payload: {
        referrerUserId: referrer.id,
        ibPartnerId,
        code: ref!.value,
        source: ref!.source,
        firstClickAt: ref!.firstClickAt.toISOString(),
        ...(self ? { selfReferral: self } : {}),
      },
    },
    tx,
  );
  await tx.query(`UPDATE referral_attributions SET last_journal_seq = $2 WHERE referee_user_id = $1`, [
    input.refereeUserId,
    seq,
  ]);
  return self
    ? { state: 'rejected', referrerUserId: referrer.id, reason: self }
    : { state: 'attributed', referrerUserId: referrer.id, ibPartnerId };
}
