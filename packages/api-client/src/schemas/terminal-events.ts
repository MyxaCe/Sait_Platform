import { z } from 'zod';
import { isoDateTimeSchema } from './common';

/**
 * События ТЕРМИНАЛА в шину платформы (ADR-023 фаза Т3, обратный контур
 * демо-торговли). Конверт — тот же платформенный event-envelope.v1, но
 * `source` здесь произвольный (терминал — не `site-web`), поэтому для
 * ПОТРЕБЛЕНИЯ используем ослабленный `incomingEnvelopeSchema`, а не
 * строгий продюсерский из events.ts.
 *
 * ЧЕРНОВИК для совместного согласования с командой терминала: конверт —
 * наш (готов), payload'ы — предложение платформы. Суммы — в ЦЕНТАХ (int),
 * как `demo_accounts.balance_cents`; объём/цена — number.
 * Ключ счёта — `(tenant, userId)`: tenant = slug сайта, userId = их `sub`.
 */

/** Входящий конверт (потребитель): source не фиксирован. Дедуп по event_id. */
export const incomingEnvelopeSchema = z.object({
  event_id: z.string().uuid(),
  event: z.string().min(1),
  version: z.number().int().positive(),
  occurred_at: isoDateTimeSchema,
  source: z.string().min(1),
  subject: z.string().optional(),
  correlation_id: z.string().uuid().optional(),
  data: z.unknown(),
});
export type IncomingEnvelope = z.infer<typeof incomingEnvelopeSchema>;

/** Общий ключ счёта во всех событиях терминала. */
const accountKey = {
  tenant: z.string().min(1),
  userId: z.string().min(1),
};

/** Открытая позиция (снапшот) — для проекции «баланс + открытые позиции». */
export const terminalPositionSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  volume: z.number().positive(),
  entryPrice: z.number().nonnegative(),
});
export type TerminalPosition = z.infer<typeof terminalPositionSchema>;

/* terminal.account.opened — терминал завёл демо-счёт пользователя */
export const terminalAccountOpenedSchema = z.object({
  ...accountKey,
  currency: z.string().length(3),
  balanceCents: z.number().int().nonnegative(),
});

/* terminal.balance.changed — новый реализованный баланс (+ снапшот позиций) */
export const terminalBalanceChangedSchema = z.object({
  ...accountKey,
  balanceCents: z.number().int(),
  reason: z.enum(['trade', 'deposit', 'reset', 'adjustment']).optional(),
  /** Полный снапшот открытых позиций на момент события (опционально) */
  positions: z.array(terminalPositionSchema).optional(),
});

/* terminal.margin.called — предупреждение о марже, до принудительного закрытия */
export const terminalMarginCalledSchema = z.object({
  ...accountKey,
  /** Достигнутый уровень маржи, целые проценты. */
  marginLevelPct: z.number().int(),
  /**
   * Уровень принудительного закрытия, целые проценты. **Опционально.**
   *
   * Порог может быть не задан вовсе — тогда закрытия нет, и сказать
   * «до закрытия осталось столько-то» нечего. Это **не ноль процентов**:
   * ноль означал бы «закроют при нулевой марже», то есть конкретную и
   * очень плохую новость. Отсутствие и значение — разные утверждения
   * (Р-118, и то же правило про пустую строку из WEB-21).
   */
  stopOutLevelPct: z.number().int().optional(),
  /** Средства счёта, целые центы. */
  equityCents: z.number().int(),
  /** Задействованная маржа, целые центы. */
  usedMarginCents: z.number().int(),
});

/* terminal.trade.executed — исполненная сделка (для ленты и P&L) */
export const terminalTradeExecutedSchema = z.object({
  ...accountKey,
  tradeId: z.string().min(1),
  symbol: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  volume: z.number().positive(),
  price: z.number().nonnegative(),
  executedAt: isoDateTimeSchema,
  realizedPnlCents: z.number().int().optional(),
  /**
   * Уровень, который ставил человек — стоп, тейк или лимит (Р-193).
   *
   * Разница с `price` и есть проскальзывание. **Опционально:** у
   * рыночного закрытия уровня нет вовсе, и строгое поле обнулило бы
   * разбор событий, лежащих в очереди и проекциях.
   *
   * Число с дробной частью, как и `price`: на ШИНЕ цены десятичные.
   * (В ручке `/deals/closed` они целые, в единицах `price_decimals`, —
   * это другая поверхность, и путать их нельзя: целое, прошедшее сюда,
   * показало бы цену в сто раз больше при двух зелёных сторонах.)
   */
  level: z.number().nonnegative().optional(),
  /**
   * Ряд цены был разорван на момент срабатывания.
   *
   * **Трёхзначно:** `true` — разрыв был, `false` — проверяли, не было,
   * **поля нет — неизвестно**. Последнее стоит у сделок, закрытых до
   * появления признака: `false` там утверждал бы, что разрыва не было,
   * то есть отвечал бы за прошлое, которого мы не видели.
   *
   * Имя `acrossGap` — кодировка на границе: внутри терминала поле зовётся
   * `across_gap`, и отображение делает публикующий (§5). Каждая сторона,
   * переводящая сама, — уже второе имя.
   */
  acrossGap: z.boolean().optional(),
});

/** Реестр «routing key → схема payload» терминальных событий (версия v1). */
export const TERMINAL_EVENT_SCHEMAS = {
  'terminal.account.opened': terminalAccountOpenedSchema,
  'terminal.balance.changed': terminalBalanceChangedSchema,
  'terminal.trade.executed': terminalTradeExecutedSchema,
  'terminal.margin.called': terminalMarginCalledSchema,
} as const;

export type TerminalEventName = keyof typeof TERMINAL_EVENT_SCHEMAS;

export const TERMINAL_EVENT_VERSION = 1;

export type TerminalAccountOpened = z.infer<typeof terminalAccountOpenedSchema>;
export type TerminalBalanceChanged = z.infer<typeof terminalBalanceChangedSchema>;
export type TerminalTradeExecuted = z.infer<typeof terminalTradeExecutedSchema>;
export type TerminalMarginCalled = z.infer<typeof terminalMarginCalledSchema>;

export type ParsedTerminalEvent =
  | { name: 'terminal.account.opened'; data: TerminalAccountOpened }
  | { name: 'terminal.balance.changed'; data: TerminalBalanceChanged }
  | { name: 'terminal.trade.executed'; data: TerminalTradeExecuted }
  | { name: 'terminal.margin.called'; data: TerminalMarginCalled };

/**
 * Лениво парсит терминальное событие из конверта: неизвестный `event`
 * или невалидный payload → null (потребитель пропускает, не падает —
 * та же двухуровневая модель, что у cabinet-home).
 */
export function parseTerminalEvent(envelope: IncomingEnvelope): ParsedTerminalEvent | null {
  const name = envelope.event as TerminalEventName;
  const schema = TERMINAL_EVENT_SCHEMAS[name];
  if (!schema) return null;
  const parsed = schema.safeParse(envelope.data);
  if (!parsed.success) return null;
  return { name, data: parsed.data } as ParsedTerminalEvent;
}
