import {
  AUTH_ERROR_CODES,
  INTERNAL_AUTH_HEADER,
  internalAuthValue,
  parseAccountsResponse,
  parseMoneyMoveResponse,
  routes,
  TERMINAL_CURRENCY,
  type AccountKind,
  type FreezeBody,
  type MoneyMoveBody,
  type TerminalAccount,
} from './terminal-contract';

/**
 * Клиент внутренних денежных маршрутов терминала. Контракт — в
 * `terminal-contract.ts`; здесь транспорт и классификация исходов. Три
 * исхода, и склеивать их нельзя:
 *  - `ok`          — терминал применил (или это идемпотентный повтор, `replay`);
 *  - `refused`     — отказ по существу (нет свободной маржи, счёт заморожен…);
 *  - `unavailable` — НЕ знаем, применено ли (сеть, 5xx, мусор, ошибка доступа).
 *    Вызывающий считает это «исход неизвестен» и разрешает повтором с тем же
 *    `external_ref`, а не переводит заявку в финальный статус.
 */

export type TerminalUnavailable = 'not-configured' | 'network' | 'http-error' | 'malformed' | 'auth';

export type MoneyMoveOutcome =
  | {
      state: 'ok';
      balanceMinor: number | null;
      freeMarginMinor?: number | null;
      seq: number | null;
      replay: boolean;
    }
  | { state: 'refused'; code: string; status: number; detail?: Record<string, unknown> }
  | { state: 'unavailable'; reason: TerminalUnavailable };

export type FreezeOutcome =
  | { state: 'ok' }
  | { state: 'refused'; code: string; status: number }
  | { state: 'unavailable'; reason: TerminalUnavailable };

export type AccountsOutcome =
  | { state: 'ok'; accounts: TerminalAccount[] }
  | { state: 'unavailable'; reason: TerminalUnavailable };

/** Тело движения денег без валюты (валюту подставляет клиент). */
export interface MoveInput {
  amount_minor: number;
  external_ref: string;
  /** Кто инициировал: `site:chain-watcher`, логин оператора… */
  operator: string;
  reason: string;
}

export interface TerminalMoneyClient {
  deposit(userId: string, body: MoveInput): Promise<MoneyMoveOutcome>;
  withdraw(userId: string, body: MoveInput): Promise<MoneyMoveOutcome>;
  tradingFreeze(userId: string, body: FreezeBody, kind?: AccountKind): Promise<FreezeOutcome>;
  accounts?(userId: string): Promise<AccountsOutcome>;
}

export interface TerminalMoneyConfig {
  baseUrl: string | undefined;
  token: string | undefined;
  /** Слаг сайта (SITE_SLUG) — часть адреса маршрутов. */
  tenant: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

type Raw = { kind: 'res'; status: number; json: unknown } | { kind: 'fail'; reason: TerminalUnavailable };

export function createTerminalMoneyClient(config: TerminalMoneyConfig): TerminalMoneyClient & {
  accounts(userId: string): Promise<AccountsOutcome>;
} {
  const baseUrl = config.baseUrl?.trim().replace(/\/$/, '');
  const token = config.token?.trim();
  const tenant = config.tenant?.trim();
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 8_000;

  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Raw> {
    if (!baseUrl || !token || !tenant) return { kind: 'fail', reason: 'not-configured' };
    let res: Response;
    try {
      res = await doFetch(`${baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          [INTERNAL_AUTH_HEADER]: internalAuthValue(token),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { kind: 'fail', reason: 'network' };
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { kind: 'res', status: res.status, json };
  }

  function errorCode(json: unknown): string | null {
    const code = (json as { error?: unknown } | null)?.error;
    return typeof code === 'string' && code.length > 0 ? code : null;
  }

  /** 4xx → отказ ИЛИ «недоступно» (ошибка доступа / без кода). */
  function classify4xx(status: number, json: unknown):
    | { state: 'refused'; code: string; status: number; detail?: Record<string, unknown> }
    | { state: 'unavailable'; reason: TerminalUnavailable } {
    const code = errorCode(json);
    if (!code) return { state: 'unavailable', reason: 'malformed' };
    if (AUTH_ERROR_CODES.includes(code)) return { state: 'unavailable', reason: 'auth' };
    return { state: 'refused', code, status, detail: json as Record<string, unknown> };
  }

  async function move(path: string, body: MoveInput): Promise<MoneyMoveOutcome> {
    const payload: MoneyMoveBody = {
      amount_minor: body.amount_minor,
      currency: TERMINAL_CURRENCY,
      external_ref: body.external_ref,
      initiator: body.operator,
      reason: body.reason,
    };
    const r = await call('POST', path, payload);
    if (r.kind === 'fail') return { state: 'unavailable', reason: r.reason };
    if (r.status >= 200 && r.status < 300) {
      const parsed = parseMoneyMoveResponse(r.json);
      if (!parsed) return { state: 'unavailable', reason: 'malformed' };
      return {
        state: 'ok',
        balanceMinor: parsed.balanceMinor,
        freeMarginMinor: parsed.freeMarginMinor,
        seq: parsed.seq,
        replay: parsed.replayed,
      };
    }
    if (r.status >= 400 && r.status < 500) return classify4xx(r.status, r.json);
    return { state: 'unavailable', reason: 'http-error' };
  }

  return {
    deposit: (userId, body) => move(routes.deposit(tenant ?? '', userId), body),
    withdraw: (userId, body) => move(routes.withdraw(tenant ?? '', userId), body),
    async tradingFreeze(userId, body, kind = 'real') {
      const r = await call('POST', routes.tradingFreeze(tenant ?? '', userId, kind), body);
      if (r.kind === 'fail') return { state: 'unavailable', reason: r.reason };
      if (r.status >= 200 && r.status < 300) return { state: 'ok' };
      if (r.status >= 400 && r.status < 500) {
        const c = classify4xx(r.status, r.json);
        return c.state === 'refused' ? { state: 'refused', code: c.code, status: c.status } : c;
      }
      return { state: 'unavailable', reason: 'http-error' };
    },
    async accounts(userId) {
      const r = await call('GET', routes.accounts(tenant ?? '', userId));
      if (r.kind === 'fail') return { state: 'unavailable', reason: r.reason };
      if (r.status < 200 || r.status >= 300) return { state: 'unavailable', reason: 'http-error' };
      const accounts = parseAccountsResponse(r.json);
      return accounts ? { state: 'ok', accounts } : { state: 'unavailable', reason: 'malformed' };
    },
  };
}

/** Клиент из окружения: `TERMINAL_INTERNAL_URL` + `INTERNAL_MONEY_TOKEN` + `SITE_SLUG`. */
export function terminalMoneyClientFromEnv(env: NodeJS.ProcessEnv = process.env) {
  return createTerminalMoneyClient({
    baseUrl: env.TERMINAL_INTERNAL_URL,
    token: env.INTERNAL_MONEY_TOKEN,
    tenant: env.SITE_SLUG,
  });
}
