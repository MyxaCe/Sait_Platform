import {
  incomingEnvelopeSchema,
  parseTerminalEvent,
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
  | 'applied'
  | 'skipped-duplicate'
  | 'skipped-tenant'
  | 'skipped-unknown';

/** Разобрать сырое сообщение шины в терминальное событие (или null). */
export function parseMessage(raw: unknown): ParsedTerminalEvent | null {
  const envelope = incomingEnvelopeSchema.safeParse(raw);
  if (!envelope.success) return null;
  return parseTerminalEvent(envelope.data);
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
        [cfg.newId(), d.userId, JSON.stringify({ symbol: d.symbol, side: d.side, volume: d.volume })],
      );
      break;
    }
  }
  return 'applied';
}
