import { z } from 'zod';
import { isoDateTimeSchema } from './common';

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

const accountKey = {
  tenant: z.string().min(1),
  userId: z.string().min(1),
  accountSeq: z.number().int().nonnegative().optional(),
  accountKind: z.enum(['demo', 'real']).optional(),
  accountId: z.string().min(1).optional(),
};

export const terminalPositionSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  volume: z.number().positive(),
  entryPrice: z.number().nonnegative(),
});
export type TerminalPosition = z.infer<typeof terminalPositionSchema>;

export const terminalAccountOpenedSchema = z.object({
  ...accountKey,
  currency: z.string().length(3),
  balanceCents: z.number().int().nonnegative(),
  balanceMinor: z.number().int().nonnegative().optional(),
  currencyMinorUnits: z.number().int().nonnegative().optional(),
});

export const terminalBalanceChangedSchema = z.object({
  ...accountKey,
  balanceCents: z.number().int(),
  balanceMinor: z.number().int().optional(),
  currency: z.string().length(3).optional(),
  currencyMinorUnits: z.number().int().nonnegative().optional(),
  reason: z
    .enum(['trade', 'deposit', 'withdrawal', 'reset', 'adjustment'])
    .nullable()
    .optional()
    .catch(null),
  positions: z.array(terminalPositionSchema).optional(),
});

export const terminalMarginCalledSchema = z.object({
  ...accountKey,
  marginLevelPct: z.number().int(),
  stopOutLevelPct: z.number().int().optional(),
  equityCents: z.number().int(),
  usedMarginCents: z.number().int(),
});

export const terminalTradeExecutedSchema = z.object({
  ...accountKey,
  tradeId: z.string().min(1),
  symbol: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  volume: z.number().positive(),
  price: z.number().nonnegative(),
  executedAt: isoDateTimeSchema,
  realizedPnlCents: z.number().int().optional(),
  realizedPnlMinor: z.number().int().optional(),
  currency: z.string().length(3).optional(),
  currencyMinorUnits: z.number().int().nonnegative().optional(),
  level: z.number().nonnegative().optional(),
  acrossGap: z.boolean().optional(),
  commissionMinor: z.number().int().nonnegative().optional().catch(undefined),
  markupMinor: z.number().int().nonnegative().optional().catch(undefined),
  marketPrice: z.number().nonnegative().optional().catch(undefined),
});

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

export function parseTerminalEvent(envelope: IncomingEnvelope): ParsedTerminalEvent | null {
  const name = envelope.event as TerminalEventName;
  const schema = TERMINAL_EVENT_SCHEMAS[name];
  if (!schema) return null;
  const parsed = schema.safeParse(envelope.data);
  if (!parsed.success) return null;
  return { name, data: parsed.data } as ParsedTerminalEvent;
}
