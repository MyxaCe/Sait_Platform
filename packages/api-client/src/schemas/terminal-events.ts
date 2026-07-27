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
});

/** Реестр «routing key → схема payload» терминальных событий (версия v1). */
export const TERMINAL_EVENT_SCHEMAS = {
  'terminal.account.opened': terminalAccountOpenedSchema,
  'terminal.balance.changed': terminalBalanceChangedSchema,
  'terminal.trade.executed': terminalTradeExecutedSchema,
} as const;

export type TerminalEventName = keyof typeof TERMINAL_EVENT_SCHEMAS;

export const TERMINAL_EVENT_VERSION = 1;

export type TerminalAccountOpened = z.infer<typeof terminalAccountOpenedSchema>;
export type TerminalBalanceChanged = z.infer<typeof terminalBalanceChangedSchema>;
export type TerminalTradeExecuted = z.infer<typeof terminalTradeExecutedSchema>;

export type ParsedTerminalEvent =
  | { name: 'terminal.account.opened'; data: TerminalAccountOpened }
  | { name: 'terminal.balance.changed'; data: TerminalBalanceChanged }
  | { name: 'terminal.trade.executed'; data: TerminalTradeExecuted };

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
