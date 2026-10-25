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
  /*
    Стартовый демо-баланс — из конфига тенанта CMS (единый источник с
    терминалом). Сеть ДО транзакции и ДО создания пользователя: отказ
    обязан случиться раньше, чем появится что-то, что придётся
    убирать. И раньше хеширования пароля: отказ не должен стоить
    секунды работы.

    **АВТОРИТЕТ ЗДЕСЬ БОЛЬШЕ НЕ НАШ** (решение штаба, 25.10).

    Барьер стоял как защита записи: кабинет собирался записать это
    число в счёт, а записать сумму, которой никто не назначал, — то
    же, что открыть счёт от чужого имени. Теперь счёт открывает
    терминал, он же читает **то же поле** карточки площадки, и
    настоящий отказ — его: названный, при открытии счёта.

    **Здесь осталась ранняя проверка того же поля, и это не второй
    писатель.** Источник один, читателей два: кто владеет значением и
    кто его показывает — разные вещи.

    **Зачем она, если авторитет у соседа.** Без неё человек
    зарегистрировался бы успешно и упёрся позже — при первом входе в
    терминал, где про сумму не думал и причины не поймёт. Ошибку
    показывают там, где она понятна, а держат там, где она
    авторитетна.

    Следствие, которое стоит помнить при правке: эта проверка может
    разойтись с терминальной во времени — мы спрашиваем при
    регистрации, он при открытии счёта. Расхождение безопасно
    **только в одну сторону**: мы пропустили, он отказал. Обратное —
    мы отказали, он бы пропустил — стоит человеку регистрации, и
    потому порог здесь не должен быть строже.
  */
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
    /*
      Денежной строки здесь больше нет (WEB-29, решение владельца).

      > Владелец денежного числа — терминал. Кабинет — проекция.

      Счёт заводит терминал — **лениво**, при первой операции
      пользователя у себя (`ensure_account_opened` на входе общего
      пути), и сообщает об этом событием `terminal.account.opened`.
      Строка появляется у нас из проекции консюмера.

      **Следствие названо, а не скрыто:** между регистрацией и первым
      входом в терминал строки нет вовсе. Это не ноль на счету и не
      ошибка — счёт ещё не открыт, и `BalanceModule` говорит именно
      так. Показать здесь сумму значило бы открыть счёт от чужого
      имени и назвать баланс, которого никто не заводил.
    */
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
