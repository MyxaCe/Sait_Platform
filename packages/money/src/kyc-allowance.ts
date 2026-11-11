import type { Queryable } from './db';
import type { TerminalMoneyClient } from './terminal-money';

/**
 * ВЫВОД БЕЗ ВЕРИФИКАЦИИ — суммарный потолок (решение владельца, 11.11).
 *
 * Клиент без пройденного KYC (при гейте «вывод только после KYC») может
 * вывести СУММАРНО ЗА ВСЁ ВРЕМЯ не больше доли `bps` от «баланса до выводов»;
 * дальше — только после верификации. Потолок суммарный (не на заявку и не за
 * период), чтобы нельзя было вывести всё частями.
 *
 *   used   = Σ заявок клиента в статусах requested | approved | sent |
 *            settled | needs_review   (rejected/cancelled — деньги вернулись
 *            или не уходили — не считаются)
 *   base   = max(0, баланс реального счёта в терминале) + Σ тех же заявок,
 *            чьё списание ПОДТВЕРЖДЕНО (debit_state = 'debited')
 *   limit  = floor(base × bps / 10 000)
 *   remain = max(0, limit − used)
 *
 * Почему в `base` только подтверждённые списания: заявка списывает деньги в
 * терминале при подаче; пока исход списания неизвестен (`pending`), сумма
 * может быть ещё в балансе — прибавив её второй раз, мы завысили бы базу.
 * В `used` такие заявки входят всегда — неизвестность трактуется строже.
 *
 * Что сознательно НЕ учитывается: плавающий P/L (баланс, а не equity —
 * незакрытая прибыль ещё не деньги) и выводы, сделанные клиентом в период,
 * когда он был верифицирован (если верификацию потом отозвали, они тоже
 * съедают потолок — суммарно «за всё время», строже).
 */

/** Статусы заявки, которые занимают потолок (деньги ушли или зарезервированы). */
export const KYC_ALLOWANCE_COUNTED_STATUSES = ['requested', 'approved', 'sent', 'settled', 'needs_review'] as const;

export interface KycWithdrawUsage {
  /** Σ занимающих потолок заявок (центы). */
  usedMinor: number;
  /** Из них — со списанием, подтверждённым терминалом. */
  usedDebitedMinor: number;
}

export interface KycAllowance {
  bps: number;
  balanceMinor: number;
  baseMinor: number;
  limitMinor: number;
  usedMinor: number;
  remainingMinor: number;
}

export async function loadKycWithdrawUsage(db: Queryable, userId: string): Promise<KycWithdrawUsage> {
  const r = await db.query(
    `SELECT COALESCE(SUM(amount_minor), 0) AS used_minor,
            COALESCE(SUM(amount_minor) FILTER (WHERE debit_state = 'debited'), 0) AS used_debited_minor
       FROM crypto_withdrawals
      WHERE user_id = $1 AND status IN ('requested', 'approved', 'sent', 'settled', 'needs_review')`,
    [userId],
  );
  const row = r.rows[0] ?? {};
  return {
    usedMinor: Number(row.used_minor ?? 0),
    usedDebitedMinor: Number(row.used_debited_minor ?? 0),
  };
}

/** Чистая формула потолка (см. шапку файла). Округление — вниз, в пользу платформы. */
export function computeKycAllowance(input: {
  bps: number;
  balanceMinor: number;
  usage: KycWithdrawUsage;
}): KycAllowance {
  const bps = Math.max(0, Math.min(10_000, Math.trunc(input.bps)));
  const balanceMinor = Math.max(0, Math.trunc(input.balanceMinor));
  const baseMinor = balanceMinor + Math.max(0, input.usage.usedDebitedMinor);
  // BigInt: base × bps может выйти за 2^53 на крупных счетах.
  const limitMinor = Number((BigInt(baseMinor) * BigInt(bps)) / 10_000n);
  const usedMinor = Math.max(0, input.usage.usedMinor);
  return {
    bps,
    balanceMinor,
    baseMinor,
    limitMinor,
    usedMinor,
    remainingMinor: Math.max(0, limitMinor - usedMinor),
  };
}

/**
 * Баланс реального счёта из терминала. `null` — посчитать нельзя (терминал
 * молчит, ответ без баланса, у клиента терминала нет метода чтения):
 * вызывающий трактует это как отказ (fail-closed). Счёта ещё нет — баланс 0.
 */
export async function readRealBalanceMinor(
  terminal: Pick<TerminalMoneyClient, 'accounts'>,
  userId: string,
): Promise<number | null> {
  if (!terminal.accounts) return null;
  const out = await terminal.accounts(userId).catch(() => null);
  if (!out || out.state !== 'ok') return null;
  const real = out.accounts.find((a) => a.kind === 'real');
  if (!real || !real.opened) return 0;
  return real.balanceMinor === null ? null : real.balanceMinor;
}

/**
 * Потолок клиента целиком: суммы из базы + баланс из терминала. `null` —
 * баланс неизвестен (fail-closed).
 */
export async function resolveKycAllowance(
  db: Queryable,
  terminal: Pick<TerminalMoneyClient, 'accounts'>,
  userId: string,
  bps: number,
): Promise<KycAllowance | null> {
  const [usage, balanceMinor] = await Promise.all([
    loadKycWithdrawUsage(db, userId),
    readRealBalanceMinor(terminal, userId),
  ]);
  if (balanceMinor === null) return null;
  return computeKycAllowance({ bps, balanceMinor, usage });
}
