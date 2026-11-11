import type { PoolLike, Queryable, TxClient } from '../db';

/**
 * In-memory фейк базы для тестов денежных переходов. Понимает ровно те
 * запросы, которые пишут модули пакета (неизвестный SQL → исключение, чтобы
 * новый запрос не прошёл тест молча). Транзакции — журнал отмены на клиента:
 * ROLLBACK откатывает только свои записи, параллельные транзакции видят
 * записи друг друга сразу (как вставки под READ COMMITTED после COMMIT —
 * достаточно, чтобы уникальность хэша проверялась на уровне оператора).
 */

export interface DepositRow {
  id: string;
  user_id: string | null;
  tx_hash: string;
  status: string;
  from_address: string | null;
  to_address: string | null;
  amount_raw: string | null;
  amount_minor: number | null;
  dust_raw: string | null;
  reject_reason: string | null;
  check_note: string | null;
  terminal_seq: number | null;
  resolved_by: string | null;
  last_journal_seq: number | null;
}

export interface WithdrawalRow {
  id: string;
  user_id: string;
  to_address: string;
  amount_minor: number;
  status: string;
  debit_state: string;
  debit_seq: number | null;
  refund_seq: number | null;
  refunded: boolean;
  reject_reason: string | null;
  payout_tx_hash: string | null;
  review_reason: string | null;
  check_note: string | null;
  decided_by: string | null;
  last_journal_seq: number | null;
}

export interface ClientState {
  blocked?: boolean;
  kycState?: string | null;
  depositKyc?: string | null;
  withdrawKyc?: string | null;
  frozen?: boolean;
  withdrawBanned?: boolean;
  /** Доля вывода без KYC у клиента (б.п.); нет — наследовать. */
  unverifiedWithdrawBps?: number | null;
}

export interface JournalRow {
  seq: number;
  operator_id: string;
  action: string;
  subject_kind: string;
  subject_id: string;
  payload: Record<string, unknown>;
  entry_hash: string;
}

export class FakeDb implements PoolLike {
  clients = new Map<string, ClientState>();
  settings = {
    deposit_requires_kyc: false,
    withdraw_requires_kyc: true,
    min_deposit_minor: 1000,
    min_withdraw_minor: 1000,
    unverified_withdraw_bps: 500,
  };
  deposits = new Map<string, DepositRow>();
  withdrawals = new Map<string, WithdrawalRow>();
  journal: JournalRow[] = [];
  private nextId = 1;
  /** Все выполненные SQL (для проверок «запрос был/не был»). */
  log: string[] = [];

  newId(): string {
    const n = (this.nextId++).toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${n}`;
  }

  async connect(): Promise<TxClient> {
    const undo: (() => void)[] = [];
    let inTx = false;
    return {
      query: async (sql: string, params: unknown[] = []) => {
        if (/^BEGIN/.test(sql)) {
          inTx = true;
          undo.length = 0;
          return { rows: [] };
        }
        if (/^COMMIT/.test(sql)) {
          inTx = false;
          undo.length = 0;
          return { rows: [] };
        }
        if (/^ROLLBACK/.test(sql)) {
          inTx = false;
          for (const u of undo.reverse()) u();
          undo.length = 0;
          return { rows: [] };
        }
        return this.exec(sql, params, inTx ? undo : null);
      },
      release() {},
    };
  }

  async query(sql: string, params: unknown[] = []) {
    return this.exec(sql, params, null);
  }

  private track<T extends object>(undo: (() => void)[] | null, row: T): void {
    if (!undo) return;
    const copy = { ...row };
    undo.push(() => Object.assign(row, copy));
  }

  private exec(
    sql: string,
    p: unknown[],
    undo: (() => void)[] | null,
  ): { rows: Record<string, unknown>[]; rowCount?: number } {
    this.log.push(sql);
    const s = sql.replace(/\s+/g, ' ').trim();
    const one = (row: Record<string, unknown> | undefined | null) =>
      row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };

    // ── журнал ──
    if (s.includes('pg_advisory_xact_lock')) return { rows: [{}] };
    if (s.startsWith('SELECT entry_hash FROM admin_action_journal')) {
      const last = this.journal[this.journal.length - 1];
      return one(last ? { entry_hash: last.entry_hash } : null);
    }
    if (s.startsWith('INSERT INTO admin_action_journal')) {
      const row: JournalRow = {
        seq: this.journal.length + 1,
        operator_id: p[1] as string,
        action: p[2] as string,
        subject_kind: p[3] as string,
        subject_id: p[4] as string,
        payload: JSON.parse(p[5] as string) as Record<string, unknown>,
        entry_hash: p[7] as string,
      };
      this.journal.push(row);
      if (undo) undo.push(() => this.journal.splice(this.journal.indexOf(row), 1));
      return { rows: [] };
    }
    if (s.startsWith('SELECT seq FROM admin_action_journal WHERE entry_hash')) {
      return one(this.journal.find((j) => j.entry_hash === p[0]) as Record<string, unknown> | undefined);
    }

    // ── политика ──
    if (s.includes('FROM users u LEFT JOIN client_blocks cb')) {
      const c = this.clients.get(p[0] as string);
      if (!c) return { rows: [] };
      return one({
        id: p[0],
        blocked: c.blocked ?? false,
        kyc_state: c.kycState ?? null,
        deposit_kyc: c.depositKyc ?? null,
        withdraw_kyc: c.withdrawKyc ?? null,
        frozen: c.frozen ?? false,
        withdraw_banned: c.withdrawBanned ?? false,
        ...this.settings,
        client_unverified_withdraw_bps: c.unverifiedWithdrawBps ?? null,
      });
    }
    if (s.startsWith('SELECT COALESCE(SUM(amount_minor), 0) AS used_minor')) {
      const counted = new Set(['requested', 'approved', 'sent', 'settled', 'needs_review']);
      const rows = [...this.withdrawals.values()].filter((w) => w.user_id === p[0] && counted.has(w.status));
      return one({
        used_minor: rows.reduce((a, w) => a + w.amount_minor, 0),
        used_debited_minor: rows.filter((w) => w.debit_state === 'debited').reduce((a, w) => a + w.amount_minor, 0),
      });
    }
    if (s.startsWith('SELECT 1 FROM users WHERE id')) return one(this.clients.has(p[0] as string) ? { x: 1 } : null);

    // ── депозиты ──
    if (s.startsWith('SELECT 1 FROM crypto_withdrawals WHERE payout_tx_hash')) {
      return one([...this.withdrawals.values()].some((w) => w.payout_tx_hash === p[0]) ? { x: 1 } : null);
    }
    if (s.startsWith('SELECT 1 FROM crypto_deposits WHERE tx_hash')) {
      return one(this.depositByHash(p[0] as string) ? { x: 1 } : null);
    }
    if (s.startsWith("INSERT INTO crypto_deposits (user_id, tx_hash, status) VALUES ($1, $2, 'claimed')")) {
      const existing = this.depositByHash(p[1] as string);
      if (existing) {
        if (existing.status === 'unidentified' && existing.user_id === null) {
          this.track(undo, existing);
          existing.user_id = p[0] as string;
          existing.status = 'claimed';
          return one({ id: existing.id, was_update: true });
        }
        return { rows: [] };
      }
      const row = this.blankDeposit(p[1] as string, p[0] as string, 'claimed');
      this.addDeposit(row, undo);
      return one({ id: row.id, was_update: false });
    }
    if (s.startsWith("INSERT INTO crypto_deposits (user_id, tx_hash, status, from_address, to_address, amount_raw, block_time) VALUES (NULL, $1, 'unidentified'")) {
      if (this.depositByHash(p[0] as string)) return { rows: [] };
      const row = this.blankDeposit(p[0] as string, null, 'unidentified');
      row.from_address = p[1] as string;
      row.to_address = p[2] as string;
      row.amount_raw = p[3] as string;
      this.addDeposit(row, undo);
      return one({ id: row.id });
    }
    if (s.startsWith('UPDATE crypto_deposits SET last_journal_seq')) {
      const d = this.deposits.get(p[0] as string)!;
      this.track(undo, d);
      d.last_journal_seq = p[1] as number;
      return { rows: [] };
    }
    if (s.startsWith('SELECT user_id, tx_hash, status FROM crypto_deposits WHERE id')) {
      const d = this.deposits.get(p[0] as string);
      return one(d ? { user_id: d.user_id, tx_hash: d.tx_hash, status: d.status } : null);
    }
    if (s.startsWith('SELECT tx_hash, status, user_id, amount_raw, from_address FROM crypto_deposits')) {
      const d = this.deposits.get(p[0] as string);
      return one(d ? { ...d } : null);
    }
    if (s.startsWith("UPDATE crypto_deposits SET status = 'credited'")) {
      const d = this.deposits.get(p[0] as string);
      if (!d || d.status !== 'claimed') return { rows: [], rowCount: 0 };
      this.track(undo, d);
      Object.assign(d, {
        status: 'credited',
        amount_minor: p[1],
        from_address: p[2],
        to_address: p[3],
        amount_raw: p[4],
        dust_raw: p[5],
        terminal_seq: p[7],
        check_note: null,
      });
      return { rows: [], rowCount: 1 };
    }
    if (s.startsWith("UPDATE crypto_deposits SET status = 'rejected'")) {
      const d = this.deposits.get(p[0] as string);
      if (!d || d.status !== 'claimed') return { rows: [], rowCount: 0 };
      this.track(undo, d);
      d.status = 'rejected';
      d.reject_reason = p[1] as string;
      d.from_address = (p[2] as string | null) ?? d.from_address;
      d.to_address = (p[3] as string | null) ?? d.to_address;
      d.amount_raw = (p[4] as string | null) ?? d.amount_raw;
      d.dust_raw = (p[5] as string | null) ?? d.dust_raw;
      return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('UPDATE crypto_deposits SET check_note')) {
      const d = this.deposits.get(p[0] as string);
      if (d) {
        this.track(undo, d);
        d.check_note = p[1] as string;
      }
      return { rows: [] };
    }
    if (s.startsWith("UPDATE crypto_deposits SET user_id = $2, status = 'credited'")) {
      const d = this.deposits.get(p[0] as string);
      if (!d || d.status !== 'unidentified' || d.user_id !== null) return { rows: [], rowCount: 0 };
      this.track(undo, d);
      Object.assign(d, {
        user_id: p[1],
        status: 'credited',
        amount_minor: p[2],
        dust_raw: p[3],
        terminal_seq: p[4],
        resolved_by: p[5],
      });
      return { rows: [], rowCount: 1 };
    }

    // ── выводы ──
    if (s.startsWith('INSERT INTO crypto_withdrawals')) {
      const row: WithdrawalRow = {
        id: this.newId(),
        user_id: p[0] as string,
        to_address: p[1] as string,
        amount_minor: p[2] as number,
        status: 'requested',
        debit_state: 'pending',
        debit_seq: null,
        refund_seq: null,
        refunded: false,
        reject_reason: null,
        payout_tx_hash: null,
        review_reason: null,
        check_note: null,
        decided_by: null,
        last_journal_seq: null,
      };
      this.withdrawals.set(row.id, row);
      if (undo) undo.push(() => this.withdrawals.delete(row.id));
      return one({ id: row.id });
    }
    const w = () => this.withdrawals.get(p[0] as string);
    if (s.startsWith('UPDATE crypto_withdrawals SET last_journal_seq')) {
      const r = w()!;
      this.track(undo, r);
      r.last_journal_seq = p[1] as number;
      return { rows: [] };
    }
    if (s.startsWith('SELECT user_id, amount_minor, status, debit_state') || s.startsWith('SELECT status, debit_state FROM crypto_withdrawals')) {
      const r = w();
      return one(r ? { ...r } : null);
    }
    if (s.startsWith('UPDATE crypto_withdrawals SET check_note')) {
      const r = w();
      if (r) {
        this.track(undo, r);
        r.check_note = p[1] as string;
      }
      return { rows: [] };
    }
    if (s.startsWith("UPDATE crypto_withdrawals SET status = 'rejected', debit_state = 'refused'")) {
      const r = w();
      if (!r || r.status !== 'requested' || r.debit_state !== 'pending') return { rows: [], rowCount: 0 };
      this.track(undo, r);
      Object.assign(r, { status: 'rejected', debit_state: 'refused', reject_reason: p[1] });
      return { rows: [], rowCount: 1 };
    }
    if (s.startsWith("UPDATE crypto_withdrawals SET debit_state = 'debited'")) {
      const r = w();
      if (!r || r.debit_state !== 'pending') return { rows: [], rowCount: 0 };
      this.track(undo, r);
      Object.assign(r, { debit_state: 'debited', debit_seq: p[1], check_note: null });
      return { rows: [], rowCount: 1 };
    }
    if (s.startsWith("UPDATE crypto_withdrawals SET status = 'approved'")) {
      const r = w();
      if (!r || r.status !== 'requested' || r.debit_state !== 'debited') return { rows: [] };
      this.track(undo, r);
      Object.assign(r, { status: 'approved', decided_by: p[1] });
      return one({ user_id: r.user_id, amount_minor: r.amount_minor, to_address: r.to_address });
    }
    if (s.startsWith('UPDATE crypto_withdrawals SET status = $2, reject_reason = $3')) {
      const r = w();
      if (!r || r.status !== p[6]) return { rows: [] };
      this.track(undo, r);
      Object.assign(r, {
        status: p[1],
        reject_reason: p[2],
        decided_by: p[3],
        refund_seq: p[4],
        refunded: r.refunded || Boolean(p[5]),
      });
      return one({ id: r.id });
    }
    if (s.startsWith("UPDATE crypto_withdrawals SET status = 'sent'")) {
      const r = w();
      if (!r || r.status !== 'approved') return { rows: [] };
      const clash = [...this.withdrawals.values()].some((o) => o.id !== r.id && o.payout_tx_hash === p[1]);
      if (clash) throw Object.assign(new Error('duplicate key'), { code: '23505' });
      this.track(undo, r);
      Object.assign(r, { status: 'sent', payout_tx_hash: p[1] });
      return one({ user_id: r.user_id });
    }
    if (s.startsWith("UPDATE crypto_withdrawals SET status = 'settled', settled_at = now(), updated_at = now(), check_note")) {
      const r = w();
      if (!r || r.status !== 'sent') return { rows: [] };
      this.track(undo, r);
      r.status = 'settled';
      return one({ user_id: r.user_id, payout_tx_hash: r.payout_tx_hash, amount_minor: r.amount_minor });
    }
    if (s.startsWith("UPDATE crypto_withdrawals SET status = 'needs_review'")) {
      const r = w();
      if (!r || r.status !== 'sent') return { rows: [] };
      this.track(undo, r);
      Object.assign(r, { status: 'needs_review', review_reason: p[1] });
      return one({ user_id: r.user_id, payout_tx_hash: r.payout_tx_hash });
    }
    if (s.startsWith("UPDATE crypto_withdrawals SET status = 'settled', settled_at = now(), decided_by")) {
      const r = w();
      if (!r || r.status !== 'needs_review') return { rows: [] };
      this.track(undo, r);
      Object.assign(r, { status: 'settled', decided_by: p[1] });
      return one({ user_id: r.user_id });
    }

    throw new Error(`FakeDb: неизвестный SQL: ${s.slice(0, 160)}`);
  }

  private depositByHash(hash: string): DepositRow | undefined {
    return [...this.deposits.values()].find((d) => d.tx_hash === hash);
  }

  private blankDeposit(txHash: string, userId: string | null, status: string): DepositRow {
    return {
      id: this.newId(),
      user_id: userId,
      tx_hash: txHash,
      status,
      from_address: null,
      to_address: null,
      amount_raw: null,
      amount_minor: null,
      dust_raw: null,
      reject_reason: null,
      check_note: null,
      terminal_seq: null,
      resolved_by: null,
      last_journal_seq: null,
    };
  }

  private addDeposit(row: DepositRow, undo: (() => void)[] | null): void {
    this.deposits.set(row.id, row);
    if (undo) undo.push(() => this.deposits.delete(row.id));
  }
}

export type { Queryable };
