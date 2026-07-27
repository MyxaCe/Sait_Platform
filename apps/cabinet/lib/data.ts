import { getPool } from './db';

/** Чтения кабинета. Все — по userId из СЕССИИ, никогда из входных данных. */

export interface DemoAccount {
  balanceCents: number;
  currency: string;
  createdAt: Date;
}

export async function getDemoAccount(userId: string): Promise<DemoAccount | null> {
  const r = await getPool().query(
    `SELECT balance_cents, currency, created_at FROM demo_accounts WHERE user_id = $1`,
    [userId],
  );
  const row = r.rows[0];
  return row
    ? { balanceCents: Number(row.balance_cents), currency: row.currency, createdAt: row.created_at }
    : null;
}

export interface OpenPosition {
  symbol: string;
  side: 'buy' | 'sell';
  volume: number;
  entryPrice: number;
}

/** Открытые позиции демо-счёта — проекция событий терминала (Т3). Пусто до подключения шины. */
export async function getOpenPositions(userId: string): Promise<OpenPosition[]> {
  const r = await getPool().query(
    `SELECT symbol, side, volume, entry_price FROM demo_positions WHERE user_id = $1 ORDER BY symbol`,
    [userId],
  );
  return r.rows.map((row) => ({
    symbol: row.symbol,
    side: row.side,
    volume: Number(row.volume),
    entryPrice: Number(row.entry_price),
  }));
}

export interface ApplicationStatus {
  submittedAt: Date;
  /** Событие ушло в шину платформы (релей отметил published_at) */
  dispatchedAt: Date | null;
  accountType: string | null;
}

/** Статус заявки на счёт: лид + факт публикации события в шину. */
export async function getApplicationStatus(email: string): Promise<ApplicationStatus | null> {
  const r = await getPool().query(
    `SELECT l.created_at,
            (l.payload::jsonb)->>'accountType' AS account_type,
            (SELECT o.published_at FROM outbox o
              WHERE (o.payload::jsonb)->'data'->>'leadId' = l.id::text
              LIMIT 1) AS published_at
       FROM leads l
      WHERE lower(l.email) = lower($1) AND l.kind = 'account-opening'
      ORDER BY l.created_at DESC
      LIMIT 1`,
    [email],
  );
  const row = r.rows[0];
  return row
    ? {
        submittedAt: row.created_at,
        dispatchedAt: row.published_at,
        accountType: row.account_type,
      }
    : null;
}

export interface DocumentRow {
  id: string;
  kind: string;
  filename: string;
  status: 'uploaded' | 'approved' | 'rejected';
  sizeBytes: number;
  createdAt: Date;
}

export async function listDocuments(userId: string): Promise<DocumentRow[]> {
  const r = await getPool().query(
    `SELECT id, kind, filename, status, size_bytes, created_at
       FROM documents WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return r.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    filename: row.filename,
    status: row.status,
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at,
  }));
}

export interface NotificationRow {
  id: string;
  type: string;
  params: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}

export async function listNotifications(userId: string, limit = 50): Promise<NotificationRow[]> {
  const r = await getPool().query(
    `SELECT id, type, params, read_at, created_at
       FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit],
  );
  return r.rows.map((row) => ({
    id: row.id,
    type: row.type,
    params: row.params ?? {},
    readAt: row.read_at,
    createdAt: row.created_at,
  }));
}

export async function countUnread(userId: string): Promise<number> {
  const r = await getPool().query(
    `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
  return r.rows[0]?.n ?? 0;
}
