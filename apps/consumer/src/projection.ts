import {
  incomingEnvelopeSchema,
  parseTerminalEvent,
  TERMINAL_EVENT_SCHEMAS,
  type ParsedTerminalEvent,
} from '@broker/api-client';

/**
 * Проекция событий терминала в БД кабинета (demo_accounts + позиции +
 * сделки + уведомления). Чистая и тестируемая: работает поверх минимального
 * `Querier` (в проде — pg-клиент внутри транзакции, в тестах — фейк).
 *
 * Идемпотентность: event_id пишется в processed_events в ТОЙ ЖЕ транзакции;
 * повтор (доставка at-least-once) отбрасывается по ON CONFLICT. Тенант чужого
 * сайта пропускается — консюмер обслуживает свой SITE_SLUG.
 */

export interface Querier {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }>;
}

export interface ProjectionConfig {
  /** Наш тенант (SITE_SLUG): события чужих сайтов пропускаем. */
  tenant: string;
  /** Генератор UUID (инъекция ради детерминизма в тестах). */
  newId: () => string;
}

export type ProjectionOutcome =
  'applied' | 'skipped-duplicate' | 'skipped-tenant' | 'skipped-unknown';

/**
 * Баланс пришёл на счёт, которого у нас нет (WEB-29).
 *
 * Это не «нечего делать», а «сделать не удалось»: деньги есть, а строки
 * нет. Бросаем, чтобы транзакция откатилась вместе с заявкой на дедуп и
 * событие можно было доставить ещё раз.
 */
export class BalanceAccountMissingError extends Error {
  constructor(userId: string, eventId: string) {
    super(
      `demo_accounts: нет строки пользователя ${userId}, баланс из события ${eventId} ` +
        'не записан. Событие не помечается обработанным — его доставят снова.',
    );
    this.name = 'BalanceAccountMissingError';
  }
}

/**
 * Итог разбора сообщения. ТРИ разных исхода там, где раньше был один `null`
 * (баг B-020): «чужое» и «наше сломанное» требуют противоположных действий, а
 * молчаливый пропуск обоих терял наши же события без следа.
 */
export type MessageClassification =
  /** Наше событие, разобрано. */
  | { kind: 'terminal-event'; eventId: string; event: ParsedTerminalEvent }
  /**
   * Не наш тип события. Пропускать ПРАВИЛЬНО: без этого нельзя выкатывать
   * части платформы порознь — сосед выкатит новый тип раньше нас.
   */
  | { kind: 'foreign'; eventId: string; event: string }
  /**
   * Конверт наш или тип наш, а разбор не прошёл. Это дефект: либо продюсер
   * шлёт не то, либо схемы разъехались. Тишина здесь — потеря нашего события.
   */
  | { kind: 'malformed'; eventId: string | null; reason: string };

/** Известные нам типы событий терминала — реестр контракта, не локальный список. */
function isOurEvent(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(TERMINAL_EVENT_SCHEMAS, name);
}

/**
 * Разобрать сырое сообщение шины, СОХРАНИВ причину неудачи.
 *
 * Мягкий разбор означает «не падает», а не «исчезает без следа»: неизвестный
 * тип отбрасывается молча и это норма, а вот наш тип со сломанным payload
 * обязан оставить след.
 */
export function classifyMessage(raw: unknown): MessageClassification {
  const envelope = incomingEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    // Лишние поля Zod срезает, а не отвергает, поэтому сюда попадает именно
    // сломанный конверт, а не более новая версия от соседа
    const issue = envelope.error.issues[0];
    const at = issue?.path.join('.') || '(root)';
    return {
      kind: 'malformed',
      eventId:
        typeof (raw as { event_id?: unknown })?.event_id === 'string'
          ? (raw as { event_id: string }).event_id
          : null,
      reason: `envelope: ${at} — ${issue?.message ?? 'invalid'}`,
    };
  }

  const { event_id: eventId, event: name } = envelope.data;
  if (!isOurEvent(name)) return { kind: 'foreign', eventId, event: name };

  const parsed = parseTerminalEvent(envelope.data);
  if (!parsed) return { kind: 'malformed', eventId, reason: `payload: ${name}` };

  return { kind: 'terminal-event', eventId, event: parsed };
}

/**
 * Применить одно событие. Вызывать ВНУТРИ транзакции (BEGIN/COMMIT — на
 * стороне вызывающего, чтобы дедуп и проекция были атомарны).
 */
export async function applyTerminalEvent(
  db: Querier,
  eventId: string,
  event: ParsedTerminalEvent,
  cfg: ProjectionConfig,
): Promise<ProjectionOutcome> {
  if (event.data.tenant !== cfg.tenant) return 'skipped-tenant';

  // Дедуп: первым делом «застолбить» event_id. Уже был → выходим.
  const claim = await db.query(
    `INSERT INTO processed_events (event_id, event) VALUES ($1, $2)
       ON CONFLICT (event_id) DO NOTHING`,
    [eventId, event.name],
  );
  if ((claim.rowCount ?? 0) === 0) return 'skipped-duplicate';

  switch (event.name) {
    case 'terminal.account.opened': {
      const d = event.data;
      await db.query(
        `INSERT INTO demo_accounts (user_id, balance_cents, currency) VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET balance_cents = EXCLUDED.balance_cents,
                                               currency = EXCLUDED.currency`,
        [d.userId, d.balanceCents, d.currency],
      );
      break;
    }
    case 'terminal.balance.changed': {
      const d = event.data;
      /*
       * Ноль обновлённых строк — ОТКАЗ, а не успех (WEB-29).
       *
       * Строки может не быть: событие обогнало `account.opened`, или
       * регистрация шла другим путём. Прежде `rowCount` здесь не
       * смотрели, функция возвращала `applied`, а `event_id` оставался в
       * `processed_events` — и повторная доставка гасилась дедупом.
       * Событие о ДЕНЬГАХ терялось окончательно, при зелёном консюмере и
       * чистом логе. Отказ, неотличимый от успеха, с ценой в деньгах.
       *
       * Почему достаточно бросить. Вся проекция идёт внутри транзакции
       * (`BEGIN` … `COMMIT` в `index.ts`), и откат уносит вместе с собой
       * заявку на дедуп. Значит сообщение уйдёт в DLX, а его повторная
       * доставка уже НЕ будет отброшена: гасить её станет нечему.
       * Отдельно удалять заявку не нужно — и не нужно её переживать.
       */
      const updated = await db.query(
        `UPDATE demo_accounts SET balance_cents = $1 WHERE user_id = $2`,
        [d.balanceCents, d.userId],
      );
      if ((updated.rowCount ?? 0) === 0) {
        throw new BalanceAccountMissingError(d.userId, eventId);
      }
      // Снапшот позиций (если пришёл) заменяем целиком — проекция идемпотентна
      if (d.positions) {
        await db.query(`DELETE FROM demo_positions WHERE user_id = $1`, [d.userId]);
        for (const p of d.positions) {
          await db.query(
            `INSERT INTO demo_positions (id, user_id, symbol, side, volume, entry_price)
               VALUES ($1, $2, $3, $4, $5, $6)`,
            [cfg.newId(), d.userId, p.symbol, p.side, p.volume, p.entryPrice],
          );
        }
      }
      break;
    }
    case 'terminal.trade.executed': {
      const d = event.data;
      await db.query(
        `INSERT INTO demo_trades
           (id, user_id, event_id, trade_id, symbol, side, volume, price, realized_pnl_cents, executed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          cfg.newId(),
          d.userId,
          eventId,
          d.tradeId,
          d.symbol,
          d.side,
          d.volume,
          d.price,
          d.realizedPnlCents ?? null,
          d.executedAt,
        ],
      );
      await db.query(
        `INSERT INTO notifications (id, user_id, type, params) VALUES ($1, $2, 'tradeExecuted', $3)`,
        [
          cfg.newId(),
          d.userId,
          /*
           * Цена кладётся в уведомление (CAB-08). Без неё сообщение
           * «Сделка исполнена: buy 0.1 EURUSD» не говорит, что произошло
           * с деньгами: человеку показывали факт сделки и умалчивали её
           * суть.
           *
           * Уровень и признак разрыва (Р-193) сюда ещё НЕ кладутся: поля
           * согласованы по смыслу, но имён у них пока нет — имя признака
           * называет терминал (§4г). Появятся имена — встанут здесь же,
           * рядом с ценой.
           */
          JSON.stringify({
            symbol: d.symbol,
            side: d.side,
            volume: d.volume,
            price: d.price,
          }),
        ],
      );
      break;
    }
    case 'terminal.margin.called': {
      const d = event.data;
      /*
       * Маржин-колл — предупреждение ДО принудительного закрытия.
       *
       * Уровней два, и это не избыточность: «ваш уровень 97 %» ничего не
       * говорит человеку, который не помнит порог. Из предупреждения
       * должно быть видно, СКОЛЬКО ОСТАЛОСЬ.
       *
       * Порог опционален, и его отсутствие — НЕ ноль: ноль означал бы
       * «закроют при нулевой марже», конкретную и очень плохую новость.
       * Поэтому кладём `null`, а не подставляем число (Р-118).
       *
       * Центы и проценты уходят целыми, как пришли: преобразование —
       * забота показа, у него есть точность и локаль.
       */
      await db.query(
        `INSERT INTO notifications (id, user_id, type, params) VALUES ($1, $2, 'marginCalled', $3)`,
        [
          cfg.newId(),
          d.userId,
          JSON.stringify({
            marginLevelPct: d.marginLevelPct,
            stopOutLevelPct: d.stopOutLevelPct ?? null,
            equityCents: d.equityCents,
            usedMarginCents: d.usedMarginCents,
          }),
        ],
      );
      break;
    }
  }
  return 'applied';
}
