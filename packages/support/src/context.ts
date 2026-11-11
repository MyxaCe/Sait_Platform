import { activeWithdrawBanSql, type Queryable } from '@broker/money';
import { supportAccess, type SupportRole } from './model';

/**
 * Контекст клиента для оператора поддержки (дизайн §3.3). Данные отбираются
 * НА СЕРВЕРЕ ПО РОЛИ — не прячутся в интерфейсе: для `support_operator`
 * выполняются другие запросы, в которых нет ни одной денежной колонки (сумм,
 * балансов, адресов, хэшей) и нет ключей KYC-документов. Чего не выбрали из
 * базы, то не утечёт ни в HTML, ни в RSC-поток. Тест проверяет и форму
 * ответа, и текст выполненных запросов.
 */

export interface MoneyOpView {
  kind: 'deposit' | 'withdrawal';
  status: string;
  at: string;
  /** Только для ролей с доступом к суммам. */
  amountMinor?: number | null;
  /** Адрес вывода / хэш депозита — только для ролей с доступом к суммам. */
  ref?: string | null;
}

export interface ClientContext {
  userId: string;
  fullName: string;
  email: string;
  locale: string;
  registeredAt: string;
  lastLoginAt: string | null;
  emailVerified: boolean;
  kycState: string;
  amlStatus: string;
  blocked: boolean;
  blockReason: string | null;
  frozen: boolean;
  withdrawBanned: boolean;
  hasRealAccount: boolean;
  recentMoney: MoneyOpView[];
  /** Есть только у ролей с доступом к суммам. */
  realBalanceMinor?: number | null;
  realCurrency?: string | null;
  /** Количество KYC-документов — только ролям, которым видны документы. */
  kycDocumentCount?: number;
  /** Что скрыто ролью — для честной подписи в интерфейсе. */
  redacted: { money: boolean; kycDocuments: boolean };
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

export async function loadClientContext(
  db: Queryable,
  role: SupportRole | null,
  userId: string,
): Promise<ClientContext | null> {
  if (!supportAccess.worksTickets(role)) return null;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const money = supportAccess.seesMoneyAmounts(role);
  const docs = supportAccess.seesKycDocuments(role);

  const base = await db.query(
    `SELECT u.id, u.full_name, u.email, u.locale, u.created_at, u.last_login_at, u.email_verified_at,
            COALESCE(v.state, 'unverified') AS kyc_state,
            COALESCE(a.status, 'unscreened') AS aml_status,
            COALESCE(b.blocked, false) AS blocked, b.reason AS block_reason,
            COALESCE(f.frozen, false) AS frozen, ${activeWithdrawBanSql('f')} AS withdraw_banned,
            EXISTS (SELECT 1 FROM real_accounts ra WHERE ra.user_id = u.id) AS has_real
       FROM users u
       LEFT JOIN client_verification v ON v.user_id = u.id
       LEFT JOIN client_aml_screening a ON a.user_id = u.id
       LEFT JOIN client_blocks b ON b.user_id = u.id
       LEFT JOIN client_money_flags f ON f.user_id = u.id
      WHERE u.id = $1`,
    [userId],
  );
  const u = base.rows[0];
  if (!u) return null;

  // Денежные операции: для support_operator — ТОЛЬКО вид, статус и дата.
  const ops = money
    ? await db.query(
        `SELECT * FROM (
           SELECT 'deposit' AS kind, status, claimed_at AS at, amount_minor, tx_hash AS ref
             FROM crypto_deposits WHERE user_id = $1
           UNION ALL
           SELECT 'withdrawal' AS kind, status, requested_at AS at, amount_minor, to_address AS ref
             FROM crypto_withdrawals WHERE user_id = $1
         ) x ORDER BY at DESC LIMIT 5`,
        [userId],
      )
    : await db.query(
        `SELECT * FROM (
           SELECT 'deposit' AS kind, status, claimed_at AS at FROM crypto_deposits WHERE user_id = $1
           UNION ALL
           SELECT 'withdrawal' AS kind, status, requested_at AS at FROM crypto_withdrawals WHERE user_id = $1
         ) x ORDER BY at DESC LIMIT 5`,
        [userId],
      );

  const ctx: ClientContext = {
    userId: String(u.id),
    fullName: String(u.full_name),
    email: String(u.email),
    locale: String(u.locale),
    registeredAt: iso(u.created_at),
    lastLoginAt: u.last_login_at ? iso(u.last_login_at) : null,
    emailVerified: Boolean(u.email_verified_at),
    kycState: String(u.kyc_state),
    amlStatus: String(u.aml_status),
    blocked: Boolean(u.blocked),
    blockReason: (u.block_reason as string | null) ?? null,
    frozen: Boolean(u.frozen),
    withdrawBanned: Boolean(u.withdraw_banned),
    hasRealAccount: Boolean(u.has_real),
    recentMoney: ops.rows.map((o) =>
      money
        ? {
            kind: o.kind as 'deposit' | 'withdrawal',
            status: String(o.status),
            at: iso(o.at),
            amountMinor: o.amount_minor == null ? null : Number(o.amount_minor),
            ref: (o.ref as string | null) ?? null,
          }
        : { kind: o.kind as 'deposit' | 'withdrawal', status: String(o.status), at: iso(o.at) },
    ),
    redacted: { money: !money, kycDocuments: !docs },
  };

  if (money) {
    const bal = await db.query(`SELECT balance_cents, currency FROM real_accounts WHERE user_id = $1`, [userId]);
    ctx.realBalanceMinor = bal.rows[0] ? Number(bal.rows[0].balance_cents) : null;
    ctx.realCurrency = (bal.rows[0]?.currency as string | undefined) ?? null;
  }
  if (docs) {
    const d = await db.query(`SELECT count(*)::int AS n FROM kyc_documents WHERE user_id = $1`, [userId]);
    ctx.kycDocumentCount = Number(d.rows[0]?.n ?? 0);
  }
  return ctx;
}

/** Колонки, которых не должно быть в запросах контекста для support_operator. */
export const MONEY_COLUMNS_FORBIDDEN_FOR_SUPPORT = [
  'amount_minor',
  'amount_raw',
  'balance_cents',
  'to_address',
  'from_address',
  'tx_hash',
  'payout_tx_hash',
  'storage_key',
] as const;
