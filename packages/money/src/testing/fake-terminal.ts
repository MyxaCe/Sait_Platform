import type { FreezeOutcome, MoneyMoveOutcome, TerminalMoneyClient } from '../terminal-money';

/**
 * Фейк терминала с ИДЕМПОТЕНТНОСТЬЮ по external_ref (как обязан вести себя
 * настоящий — предположение 1 контракта): повтор того же ref не двигает
 * баланс. Сценарий исхода задаётся очередью `next`.
 */
export class FakeTerminal implements TerminalMoneyClient {
  balances = new Map<string, number>();
  applied = new Map<string, { userId: string; delta: number; seq: number }>();
  calls: { op: string; userId: string; ref?: string; amount?: number }[] = [];
  frozen = new Map<string, boolean>();
  /** Следующие исходы: 'ok' | refused-код | 'unavailable' | 'apply-then-unavailable'. */
  next: string[] = [];
  private seq = 0;

  private take(): string {
    return this.next.shift() ?? 'ok';
  }

  private move(op: 'deposit' | 'withdraw', userId: string, ref: string, amount: number): MoneyMoveOutcome {
    this.calls.push({ op, userId, ref, amount });
    const mode = this.take();
    if (mode === 'unavailable') return { state: 'unavailable', reason: 'network' };
    const prior = this.applied.get(ref);
    if (prior) {
      return { state: 'ok', balanceMinor: this.balances.get(prior.userId) ?? 0, seq: prior.seq, replay: true };
    }
    if (mode !== 'ok' && mode !== 'apply-then-unavailable') return { state: 'refused', code: mode, status: 422 };
    const bal = this.balances.get(userId) ?? 0;
    const delta = op === 'deposit' ? amount : -amount;
    if (op === 'withdraw' && bal < amount) return { state: 'refused', code: 'insufficient_free_margin', status: 422 };
    this.balances.set(userId, bal + delta);
    const seq = ++this.seq;
    this.applied.set(ref, { userId, delta, seq });
    if (mode === 'apply-then-unavailable') return { state: 'unavailable', reason: 'network' };
    return { state: 'ok', balanceMinor: bal + delta, seq, replay: false };
  }

  async deposit(userId: string, body: { amount_minor: number; external_ref: string }) {
    return this.move('deposit', userId, body.external_ref, body.amount_minor);
  }

  async withdraw(userId: string, body: { amount_minor: number; external_ref: string }) {
    return this.move('withdraw', userId, body.external_ref, body.amount_minor);
  }

  async tradingFreeze(userId: string, body: { frozen: boolean }): Promise<FreezeOutcome> {
    this.calls.push({ op: 'freeze', userId });
    const mode = this.take();
    if (mode === 'unavailable') return { state: 'unavailable', reason: 'network' };
    if (mode !== 'ok') return { state: 'refused', code: mode, status: 422 };
    this.frozen.set(userId, body.frozen);
    return { state: 'ok' };
  }
}
