import {
  incomingEnvelopeSchema,
  parseTerminalEvent,
  TERMINAL_EVENT_SCHEMAS,
  type ParsedTerminalEvent,
  moneyFromEvent,
} from '@broker/api-client';
import { applyDemoResetToContests } from './contest-reset';

export interface Querier {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }>;
}

export interface ProjectionConfig {
  tenant: string;
  newId: () => string;
}

export type ProjectionOutcome =
  | 'applied'
  | 'skipped-duplicate'
  | 'skipped-tenant'
  | 'skipped-unknown'
  | 'skipped-stale';

export class BalanceAccountMissingError extends Error {
  constructor(userId: string, eventId: string) {
    super(
      `demo_accounts: нет строки пользователя ${userId}, баланс из события ${eventId} ` +
        'не записан. Событие не помечается обработанным — его доставят снова.',
    );
    this.name = 'BalanceAccountMissingError';
  }
}

export type ProjectionAccountKind = 'demo' | 'real';

const TABLES: Record<
  ProjectionAccountKind,
  { accounts: string; positions: string; trades: string }
> = {
  demo: { accounts: 'demo_accounts', positions: 'demo_positions', trades: 'demo_trades' },
  real: { accounts: 'real_accounts', positions: 'real_positions', trades: 'real_trades' },
};

export function accountKindOf(data: { accountKind?: string | null }): ProjectionAccountKind {
  return data.accountKind === 'real' ? 'real' : 'demo';
}

export type MessageClassification =
  | { kind: 'terminal-event'; eventId: string; event: ParsedTerminalEvent }
  | { kind: 'foreign'; eventId: string; event: string }
  | { kind: 'malformed'; eventId: string | null; reason: string };

function isOurEvent(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(TERMINAL_EVENT_SCHEMAS, name);
}

export function classifyMessage(raw: unknown): MessageClassification {
  const envelope = incomingEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
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

export async function applyTerminalEvent(
  db: Querier,
  eventId: string,
  event: ParsedTerminalEvent,
  cfg: ProjectionConfig,
): Promise<ProjectionOutcome> {
  if (event.data.tenant !== cfg.tenant) return 'skipped-tenant';

  const claim = await db.query(
    `INSERT INTO processed_events (event_id, event) VALUES ($1, $2)
       ON CONFLICT (event_id) DO NOTHING`,
    [eventId, event.name],
  );
  if ((claim.rowCount ?? 0) === 0) return 'skipped-duplicate';

  const kind = accountKindOf(event.data);
  const T = TABLES[kind];

  switch (event.name) {
    case 'terminal.account.opened': {
      const d = event.data;
      if (kind === 'real') {
        await db.query(
          `INSERT INTO real_accounts (user_id, account_uuid, balance_cents, currency, account_seq)
                VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id) DO UPDATE
                 SET account_uuid = COALESCE(EXCLUDED.account_uuid, real_accounts.account_uuid),
                     currency = EXCLUDED.currency`,
          [
            d.userId,
            d.accountId ?? null,
            moneyFromEvent({
              field: 'balance',
              cents: d.balanceCents,
              minor: d.balanceMinor,
              currency: d.currency,
              currencyMinorUnits: d.currencyMinorUnits,
            })?.minor ?? d.balanceCents,
            d.currency,
            d.accountSeq ?? null,
          ],
        );
        break;
      }
      await db.query(
        `INSERT INTO demo_accounts (user_id, balance_cents, currency) VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET balance_cents = EXCLUDED.balance_cents,
                                               currency = EXCLUDED.currency`,
        [
          d.userId,
          moneyFromEvent({
            field: 'balance',
            cents: d.balanceCents,
            minor: d.balanceMinor,
            currency: d.currency,
            currencyMinorUnits: d.currencyMinorUnits,
          })?.minor ?? d.balanceCents,
          d.currency,
        ],
      );
      break;
    }
    case 'terminal.balance.changed': {
      const d = event.data;
      const applied =
        moneyFromEvent({
          field: 'balance',
          cents: d.balanceCents,
          minor: d.balanceMinor,
          currency: d.currency,
          currencyMinorUnits: d.currencyMinorUnits,
        })?.minor ?? d.balanceCents;

      const accountSeq = d.accountSeq ?? null;
      if (kind === 'real') {
        const up = await db.query(
          `INSERT INTO real_accounts (user_id, account_uuid, balance_cents, currency, account_seq)
                VALUES ($1, $2, $3, COALESCE($4, 'USD'), $5)
           ON CONFLICT (user_id) DO UPDATE
                 SET balance_cents = EXCLUDED.balance_cents,
                     account_seq = COALESCE(EXCLUDED.account_seq, real_accounts.account_seq),
                     account_uuid = COALESCE(EXCLUDED.account_uuid, real_accounts.account_uuid)
               WHERE EXCLUDED.account_seq IS NULL
                  OR real_accounts.account_seq IS NULL
                  OR real_accounts.account_seq < EXCLUDED.account_seq`,
          [d.userId, d.accountId ?? null, applied, d.currency ?? null, accountSeq],
        );
        if ((up.rowCount ?? 0) === 0) return 'skipped-stale';
      } else {
        const updated = await db.query(
          `UPDATE demo_accounts
            SET balance_cents = $1,
                account_seq   = COALESCE($2, account_seq)
          WHERE user_id = $3
            AND ($2::bigint IS NULL OR account_seq IS NULL OR account_seq < $2)`,
          [applied, accountSeq, d.userId],
        );
        if ((updated.rowCount ?? 0) === 0) {
          const exists = await db.query(`SELECT 1 FROM demo_accounts WHERE user_id = $1`, [
            d.userId,
          ]);
          if ((exists.rowCount ?? 0) === 0) {
            throw new BalanceAccountMissingError(d.userId, eventId);
          }
          return 'skipped-stale';
        }
      }
      if (d.reason === 'reset' && kind === 'demo') {
        await db.query(
          `INSERT INTO notifications (id, user_id, type, params) VALUES ($1, $2, 'demoReset', $3)`,
          [cfg.newId(), d.userId, JSON.stringify({ balanceCents: applied })],
        );
        await applyDemoResetToContests(db, {
          userId: d.userId,
          balanceMinor: Number(applied),
          at: new Date().toISOString(),
        });
      }

      if (d.positions) {
        await db.query(`DELETE FROM ${T.positions} WHERE user_id = $1`, [d.userId]);
        for (const p of d.positions) {
          await db.query(
            `INSERT INTO ${T.positions} (id, user_id, symbol, side, volume, entry_price)
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
        `INSERT INTO ${T.trades}
           (id, user_id, event_id, trade_id, symbol, side, volume, price, realized_pnl_cents, executed_at,
            commission_minor, markup_minor, market_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
          moneyFromEvent({
            field: 'realizedPnl',
            cents: d.realizedPnlCents,
            minor: d.realizedPnlMinor,
            currency: d.currency,
            currencyMinorUnits: d.currencyMinorUnits,
          })?.minor ?? null,
          d.executedAt,
          d.commissionMinor ?? null,
          d.markupMinor ?? null,
          d.marketPrice ?? null,
        ],
      );
      await db.query(
        `INSERT INTO notifications (id, user_id, type, params) VALUES ($1, $2, 'tradeExecuted', $3)`,
        [
          cfg.newId(),
          d.userId,
          JSON.stringify({
            symbol: d.symbol,
            side: d.side,
            volume: d.volume,
            price: d.price,
            level: d.level ?? null,
            acrossGap: d.acrossGap ?? null,
          }),
        ],
      );
      break;
    }
    case 'terminal.margin.called': {
      const d = event.data;
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
