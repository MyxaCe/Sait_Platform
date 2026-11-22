import type { AccountKind, LeverageBody } from '../terminal-contract';
import type {
  AccountsOutcome,
  FreezeOutcome,
  LeverageOutcome,
  MoneyMoveOutcome,
  TerminalMoneyClient,
} from '../terminal-money';

export class FakeTerminal implements TerminalMoneyClient {
  balances = new Map<string, number>();
  applied = new Map<string, { userId: string; delta: number; seq: number }>();
  calls: { op: string; userId: string; ref?: string; amount?: number }[] = [];
  frozen = new Map<string, boolean>();
  leverage = new Map<string, number>();
  classes = new Map<string, Record<string, number>>();
  supportsClasses = false;
  platformLeverage = 20;
  opened: Set<string> | null = null;
  leverageCalls: {
    userId: string;
    kind: AccountKind;
    leverage: number;
    reason: string;
    base?: number;
    classes?: Record<string, number>;
  }[] = [];
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

  async setLeverage(userId: string, body: LeverageBody, kind: AccountKind): Promise<LeverageOutcome> {
    this.calls.push({ op: `leverage:${kind}`, userId });
    this.leverageCalls.push({
      userId,
      kind,
      leverage: body.leverage,
      reason: body.reason,
      ...(body.leverage_base !== undefined ? { base: body.leverage_base } : {}),
      ...(body.leverage_classes !== undefined ? { classes: body.leverage_classes } : {}),
    });
    const key = `${userId}:${kind}`;
    if (this.opened && !this.opened.has(key)) return { state: 'not-opened' };
    const mode = this.take();
    if (mode === 'unavailable') return { state: 'unavailable', reason: 'network' };
    if (mode !== 'ok') return { state: 'refused', code: mode, status: 400 };
    const previous = this.leverage.get(key) ?? this.platformLeverage;
    if (!this.supportsClasses) {
      this.leverage.set(key, body.leverage);
      return {
        state: 'ok',
        leverage: body.leverage,
        previousLeverage: previous,
        previousClasses: null,
        changed: previous !== body.leverage,
        seq: ++this.seq,
      };
    }
    const previousClasses = this.classes.get(key) ?? {};
    const table = body.leverage_base !== undefined && body.leverage_classes !== undefined;
    const base = table ? body.leverage_base! : body.leverage;
    const classes = table ? { ...body.leverage_classes! } : {};
    this.leverage.set(key, base);
    this.classes.set(key, classes);
    const changed = previous !== base || JSON.stringify(previousClasses) !== JSON.stringify(classes);
    return { state: 'ok', leverage: body.leverage, previousLeverage: previous, previousClasses, changed, seq: ++this.seq };
  }

  accountsUnavailable = false;
  async accounts(userId: string): Promise<AccountsOutcome> {
    this.calls.push({ op: 'accounts', userId });
    if (this.accountsUnavailable) return { state: 'unavailable', reason: 'network' };
    const opened = this.balances.has(userId);
    return {
      state: 'ok',
      accounts: [
        {
          kind: 'real',
          accountId: opened ? `acc-${userId}` : null,
          opened,
          currency: 'USD',
          balanceMinor: opened ? this.balances.get(userId)! : null,
          equityMinor: null,
          freeMarginMinor: null,
          usedMarginMinor: null,
          openPositions: 0,
          tradingFrozen: this.frozen.get(userId) ?? false,
          leverage: null,
        },
      ],
    };
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
