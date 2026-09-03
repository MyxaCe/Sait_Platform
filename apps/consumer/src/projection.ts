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
      await db.query(`UPDATE demo_accounts SET balance_cents = $1 WHERE user_id = $2`, [
        d.balanceCents,
        d.userId,
      ]);
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
          JSON.stringify({ symbol: d.symbol, side: d.side, volume: d.volume }),
        ],
      );
      break;
    }
  }
  return 'applied';
}
