import type { PoolLike, Queryable, TxClient } from '@broker/money';

/**
 * In-memory фейк базы для очереди начислений (`queue.ts`). Понимает РОВНО
 * запросы очереди; неизвестный SQL — исключение (новый запрос не пройдёт тест
 * молча).
 *
 * Главное, ради чего он есть, — семантика ЗАМКОВ строк, как у Postgres:
 * `SELECT … FOR UPDATE` по начислению и `UPDATE promotions` берут замок строки
 * до COMMIT/ROLLBACK своей транзакции; чужая транзакция ЖДЁТ (асинхронно), а
 * после освобождения видит уже закоммиченное. Так тест гонки двух одобрений —
 * настоящая гонка, а не последовательный вызов. Откат — журнал отмены.
 */

export interface FakeReward {
  id: string;
  kind: string;
  promotion_id: string | null;
  participation_id: string | null;
  user_id: string;
  amount_minor: number;
  status: string;
  external_ref: string;
  decided_by: string | null;
  decision_reason: string | null;
  reject_reason: string | null;
  check_note: string | null;
  terminal_seq: number | null;
  last_journal_seq: number | null;
}

export interface FakePromotion {
  id: string;
  budget_minor: number;
  spent_minor: number;
}

class RowLock {
  private owner: symbol | null = null;
  private waiters: Array<() => void> = [];
  async acquire(tx: symbol): Promise<void> {
    if (this.owner === tx) return;
    while (this.owner !== null) await new Promise<void>((r) => this.waiters.push(r));
    this.owner = tx;
  }
  release(tx: symbol): void {
    if (this.owner !== tx) return;
    this.owner = null;
    const w = this.waiters.shift();
    if (w) w();
  }
}

export class FakeQueueDb implements PoolLike {
  rewards = new Map<string, FakeReward>();
  promotions = new Map<string, FakePromotion>();
  participations = new Map<string, { status: string }>();
  journal: { seq: number; action: string; operator_id: string; subject_id: string; payload: Record<string, unknown>; entry_hash: string }[] = [];
  private locks = new Map<string, RowLock>();
  private nextId = 1;

  newId(): string {
    return `00000000-0000-4000-8000-${(this.nextId++).toString(16).padStart(12, '0')}`;
  }

  addReward(r: Partial<FakeReward> & Pick<FakeReward, 'user_id' | 'amount_minor' | 'external_ref'>): FakeReward {
    const row: FakeReward = {
      id: this.newId(),
      kind: 'promo',
      promotion_id: null,
      participation_id: null,
      status: 'pending',
      decided_by: null,
      decision_reason: null,
      reject_reason: null,
      check_note: null,
      terminal_seq: null,
      last_journal_seq: null,
      ...r,
    };
    this.rewards.set(row.id, row);
    return row;
  }

  private lock(key: string): RowLock {
    let l = this.locks.get(key);
    if (!l) {
      l = new RowLock();
      this.locks.set(key, l);
    }
    return l;
  }

  async connect(): Promise<TxClient> {
    const tx = Symbol('tx');
    const undo: (() => void)[] = [];
    const held = new Set<string>();
    const releaseAll = () => {
      for (const k of held) this.lock(k).release(tx);
      held.clear();
    };
    return {
      query: async (sql: string, params: unknown[] = []) => {
        const s = sql.replace(/\s+/g, ' ').trim();
        if (s === 'BEGIN') return { rows: [] };
        if (s === 'COMMIT') {
          undo.length = 0;
          releaseAll();
          return { rows: [] };
        }
        if (s === 'ROLLBACK') {
          for (const u of undo.reverse()) u();
          undo.length = 0;
          releaseAll();
          return { rows: [] };
        }
        const take = async (key: string) => {
          await this.lock(key).acquire(tx);
          held.add(key);
        };
        return this.exec(s, params, undo, take);
      },
      release() {},
    };
  }

  async query(sql: string, params: unknown[] = []) {
    return this.exec(sql.replace(/\s+/g, ' ').trim(), params, [], async () => {});
  }

  private snapshot<T extends object>(undo: (() => void)[], row: T) {
    const copy = { ...row };
    undo.push(() => Object.assign(row, copy));
  }

  private async exec(
    s: string,
    p: unknown[],
    undo: (() => void)[],
    take: (key: string) => Promise<void>,
  ): Promise<{ rows: Record<string, unknown>[]; rowCount?: number }> {
    const one = (row: Record<string, unknown> | null | undefined) => (row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 });

    // ── журнал ──
    if (s.includes('pg_advisory_xact_lock')) {
      await take('journal');
      return { rows: [{}] };
    }
    if (s.startsWith('SELECT entry_hash FROM admin_action_journal')) {
      const last = this.journal[this.journal.length - 1];
      return one(last ? { entry_hash: last.entry_hash } : null);
    }
    if (s.startsWith('INSERT INTO admin_action_journal')) {
      const row = {
        seq: this.journal.length + 1,
        operator_id: p[1] as string,
        action: p[2] as string,
        subject_id: p[4] as string,
        payload: JSON.parse(p[5] as string) as Record<string, unknown>,
        entry_hash: p[7] as string,
      };
      this.journal.push(row);
      undo.push(() => this.journal.splice(this.journal.indexOf(row), 1));
      return { rows: [] };
    }
    if (s.startsWith('SELECT seq FROM admin_action_journal WHERE entry_hash')) {
      return one(this.journal.find((j) => j.entry_hash === p[0]) as unknown as Record<string, unknown>);
    }

    // ── начисления ──
    if (s.startsWith('INSERT INTO promo_rewards')) {
      const ref = p[8] as string;
      if ([...this.rewards.values()].some((r) => r.external_ref === ref)) return { rows: [] };
      const row = this.addReward({
        kind: p[0] as string,
        promotion_id: (p[1] as string | null) ?? null,
        participation_id: (p[3] as string | null) ?? null,
        user_id: p[4] as string,
        amount_minor: p[6] as number,
        external_ref: ref,
      });
      undo.push(() => this.rewards.delete(row.id));
      return one({ id: row.id });
    }
    if (s.startsWith('SELECT id::text AS id, kind, promotion_id::text') && s.endsWith('FOR UPDATE')) {
      const id = p[0] as string;
      await take(`reward:${id}`);
      const r = this.rewards.get(id);
      return one(r ? { ...r } : null);
    }
    if (s.startsWith('UPDATE promo_rewards SET last_journal_seq')) {
      const r = this.rewards.get(p[0] as string);
      if (r) {
        this.snapshot(undo, r);
        r.last_journal_seq = p[1] as number;
      }
      return { rows: [] };
    }
    if (s.startsWith("UPDATE promo_rewards SET status = 'approved', decided_by = $2, decided_at = now(), decision_reason = $3")) {
      const r = this.rewards.get(p[0] as string);
      if (r && r.status === 'pending') {
        this.snapshot(undo, r);
        Object.assign(r, { status: 'approved', decided_by: p[1], decision_reason: p[2] });
      }
      return { rows: [] };
    }
    if (s.startsWith("UPDATE promo_rewards SET status = 'approved', decided_by = $2, decision_reason = $3")) {
      const r = this.rewards.get(p[0] as string);
      if (r && r.status === 'needs_review') {
        this.snapshot(undo, r);
        Object.assign(r, { status: 'approved', decided_by: p[1], decision_reason: p[2] });
      }
      return { rows: [] };
    }
    if (s.startsWith('UPDATE promo_rewards SET check_note = $2')) {
      const r = this.rewards.get(p[0] as string)!;
      this.snapshot(undo, r);
      r.check_note = p[1] as string;
      return { rows: [] };
    }
    if (s.startsWith("UPDATE promo_rewards SET status = 'needs_review'")) {
      const r = this.rewards.get(p[0] as string)!;
      if (r.status === 'approved') {
        this.snapshot(undo, r);
        Object.assign(r, { status: 'needs_review', check_note: p[1] });
      }
      return { rows: [] };
    }
    if (s.startsWith("UPDATE promo_rewards SET status = 'credited'")) {
      const r = this.rewards.get(p[0] as string)!;
      if (r.status === 'approved') {
        this.snapshot(undo, r);
        Object.assign(r, { status: 'credited', terminal_seq: p[1], check_note: null });
      }
      return { rows: [] };
    }
    if (s.startsWith("UPDATE promo_rewards SET status = 'rejected'")) {
      const r = this.rewards.get(p[0] as string)!;
      this.snapshot(undo, r);
      Object.assign(r, { status: 'rejected', decided_by: p[1], reject_reason: p[2], decision_reason: r.decision_reason ?? p[2] });
      return { rows: [] };
    }

    // ── участие ──
    if (s.startsWith('UPDATE promo_participations SET status = ')) {
      const part = this.participations.get(p[0] as string);
      const to = /status = '(\w+)'/.exec(s)![1]!;
      if (part && (part.status === 'enrolled' || part.status === 'qualified')) {
        const was = part.status;
        undo.push(() => (part.status = was));
        part.status = to;
      }
      return { rows: [] };
    }

    // ── бюджет акции ──
    if (s.startsWith('UPDATE promotions SET spent_minor = spent_minor + $2')) {
      const id = p[0] as string;
      await take(`promotion:${id}`);
      const promo = this.promotions.get(id);
      const amount = p[1] as number;
      if (!promo || promo.spent_minor + amount > promo.budget_minor) return { rows: [], rowCount: 0 };
      this.snapshot(undo, promo);
      promo.spent_minor += amount;
      // CHECK promotions_budget_not_exceeded — последний рубеж.
      if (promo.spent_minor > promo.budget_minor) throw Object.assign(new Error('check'), { code: '23514' });
      return one({ budget_minor: promo.budget_minor, spent_minor: promo.spent_minor });
    }
    if (s.startsWith('UPDATE promotions SET spent_minor = spent_minor - $2')) {
      const id = p[0] as string;
      await take(`promotion:${id}`);
      const promo = this.promotions.get(id);
      if (promo && promo.spent_minor >= (p[1] as number)) {
        this.snapshot(undo, promo);
        promo.spent_minor -= p[1] as number;
      }
      return { rows: [] };
    }
    if (s.startsWith('SELECT 1 FROM promotions WHERE id::text = $1')) {
      return one(this.promotions.has(p[0] as string) ? { x: 1 } : null);
    }

    throw new Error(`FakeQueueDb: неизвестный SQL: ${s.slice(0, 120)}`);
  }
}

/** Пул-обёртка — тип `Queryable` для вызовов вне транзакции. */
export type { Queryable };
