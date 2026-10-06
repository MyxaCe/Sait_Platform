import { randomUUID } from 'node:crypto';
import {
  buildLeadSubmittedEnvelope,
  LEAD_SUBMITTED_ROUTING_KEY,
  type LeadSubmittedData,
} from '@broker/api-client';
import { getPool } from '../db';
import { getTenantStartBalance } from '../tenant';
import { hashPassword } from './password';

/**
 * Регистрация = открытие счёта (ADR-022, решение 3): в ОДНОЙ транзакции
 * user + lead(account-opening) + outbox lead.submitted (конверт v1 —
 * для CRM ничего не меняется) + welcome-уведомление + демо-счёт на сумму
 * из конфига тенанта.
 *
 * **Сумму назначает владелец в CMS, и если он её не назначил —
 * регистрация отказывает** (Р-040). Своё число не подставляется: клиент
 * получил бы баланс, за который никто не отвечает, и разошёлся бы с
 * терминалом, читающим тот же конфиг.
 *
 * Отказывает именно регистрация целиком, а не «счёт без денег»: по
 * ADR-022 регистрация И ЕСТЬ открытие счёта. Завести пользователя без
 * демо-счёта значило бы впустить его в кабинет, где ничего не работает,
 * а повторная попытка упёрлась бы в «email занят» — отказ, выглядящий
 * как чужая ошибка.
 */

export interface RegisterInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  accountType: 'standard' | 'pro' | 'ecn';
  password: string;
  locale: 'ru' | 'en';
}

/**
 * Причина отказа. Их три, и ни одна не сводится к другой: первая — про
 * клиента, вторая — про незаполненную карточку сайта, третья — про
 * недоступный источник. Склеить их в один исход значит отправить
 * человека чинить не то (Р-025, п. 2).
 */
export type RegisterRefusal =
  /** Такой email уже зарегистрирован. */
  | { ok: false; reason: 'emailExists' }
  /** CMS ответила `demoStartBalanceCents: null` — владелец сумму не
   *  назначал. Чинится одним полем карточки сайта. */
  | { ok: false; reason: 'startBalanceUnset' }
  /** Конфиг тенанта получить не удалось либо в поле мусор. Чинится
   *  совсем в другом месте. */
  | { ok: false; reason: 'startBalanceUnavailable'; detail: string };

export type RegisterResult = { ok: true; userId: string } | RegisterRefusal;

const PG_UNIQUE_VIOLATION = '23505';

export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  const userId = randomUUID();
  const leadId = randomUUID();
  const occurredAt = new Date().toISOString();
  // Стартовый демо-баланс — из конфига тенанта CMS (единый источник с
  // терминалом). Сеть ДО транзакции и ДО создания пользователя: отказ
  // обязан случиться раньше, чем появится что-то, что придётся убирать.
  // И раньше хеширования пароля: отказ не должен стоить секунды работы.
  const startBalance = await getTenantStartBalance();
  if (startBalance.state !== 'set') {
    // Отказ без следа непроверяем: наружу уходит ключ объяснения, в лог —
    // то, по чему дежурный поймёт, куда идти.
    console.error(
      `[register] отказ: стартовый демо-баланс не назначен (${startBalance.state})`,
      { state: startBalance.state, reason: 'reason' in startBalance ? startBalance.reason : null },
    );
    return startBalance.state === 'unset'
      ? { ok: false, reason: 'startBalanceUnset' }
      : { ok: false, reason: 'startBalanceUnavailable', detail: startBalance.reason };
  }
  const startBalanceCents = startBalance.cents;
  const passwordHash = await hashPassword(input.password);

  const leadData: LeadSubmittedData = {
    kind: 'account-opening',
    leadId,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    country: input.country,
    accountType: input.accountType,
    locale: input.locale,
    source: { promo: 'cabinet-registration' },
  };
  const envelope = buildLeadSubmittedEnvelope(randomUUID(), occurredAt, leadData);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO users (id, email, password_hash, full_name, locale)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, input.email, passwordHash, `${input.firstName} ${input.lastName}`, input.locale],
    );
    await client.query(
      `INSERT INTO leads (id, kind, email, locale, payload) VALUES ($1, $2, $3, $4, $5)`,
      [leadId, 'account-opening', input.email, input.locale, JSON.stringify(leadData)],
    );
    await client.query(
      `INSERT INTO outbox (event_id, routing_key, payload, occurred_at) VALUES ($1, $2, $3, $4)`,
      [envelope.event_id, LEAD_SUBMITTED_ROUTING_KEY, JSON.stringify(envelope), occurredAt],
    );
    await client.query(`INSERT INTO demo_accounts (user_id, balance_cents) VALUES ($1, $2)`, [
      userId,
      startBalanceCents,
    ]);
    await client.query(
      `INSERT INTO notifications (id, user_id, type, params) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), userId, 'welcome', JSON.stringify({ accountType: input.accountType })],
    );
    await client.query('COMMIT');
    return { ok: true, userId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      return { ok: false, reason: 'emailExists' };
    }
    throw error;
  } finally {
    client.release();
  }
}
