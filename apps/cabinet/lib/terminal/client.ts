import { issueHandoffToken, tenantSlug, type AccountKind } from '@/lib/sso/jwt';
import { terminalLeverageFor } from '@/lib/leverage';
import { terminalFeesFor } from '@/lib/fees';
import { parseClosedDeals, type ClosedDeal } from './closed-deals';

export type TerminalFailure = 'not-configured' | 'network' | 'http-error' | 'malformed';

export type ClosedDealsOutcome =
  | { state: 'available'; deals: ClosedDeal[] }
  | { state: 'unavailable'; reason: TerminalFailure };

const TIMEOUT_MS = 3_000;

async function openSession(base: string, userId: string, account: AccountKind = 'demo'): Promise<string | TerminalFailure> {
  let handoff: Awaited<ReturnType<typeof issueHandoffToken>>;
  if (account === 'real') {
    // Реальный счёт — тот же токен, что при запуске терминала: с плечом и тарифом клиента (Р-446).
    // Без плеча токен не выпускаем, а не открываем сессию «как получится».
    let leverage: Awaited<ReturnType<typeof terminalLeverageFor>>;
    try {
      leverage = await terminalLeverageFor(userId);
    } catch {
      return 'not-configured';
    }
    const fees = await terminalFeesFor(userId).catch(() => null);
    handoff = await issueHandoffToken(userId, 'real', leverage, fees);
  } else {
    handoff = await issueHandoffToken(userId);
  }
  try {
    const res = await fetch(`${base}/v1/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: handoff.token, site: tenantSlug() }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return 'http-error';

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return 'malformed';
    }
    const token = (body as { token?: unknown } | null)?.token;
    return typeof token === 'string' && token.length > 0 ? token : 'malformed';
  } catch {
    return 'network';
  }
}

export async function getClosedDeals(userId: string, account: AccountKind = 'demo'): Promise<ClosedDealsOutcome> {
  const base = process.env.TERMINAL_HTTP_URL?.replace(/\/$/, '');
  if (!base) return { state: 'unavailable', reason: 'not-configured' };

  const session = await openSession(base, userId, account);
  if (session === 'not-configured' || session === 'network' || session === 'http-error' || session === 'malformed') {
    return { state: 'unavailable', reason: session };
  }

  try {
    const res = await fetch(`${base}/deals/closed`, {
      headers: { authorization: `Bearer ${session}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { state: 'unavailable', reason: 'http-error' };

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { state: 'unavailable', reason: 'malformed' };
    }

    if (!Array.isArray(body)) return { state: 'unavailable', reason: 'malformed' };
    return { state: 'available', deals: parseClosedDeals(body) };
  } catch {
    return { state: 'unavailable', reason: 'network' };
  }
}

export type ResetRefusal =
  | 'not_a_demo_account'
  | 'account_not_flat';

export type ResetOutcome =
  | { state: 'accepted' }
  | { state: 'refused'; reason: ResetRefusal | null; raw: string | null }
  | { state: 'unavailable'; reason: TerminalFailure };

const RESET_REFUSALS: readonly string[] = ['not_a_demo_account', 'account_not_flat'];

export async function resetDemoAccount(userId: string): Promise<ResetOutcome> {
  const base = process.env.TERMINAL_HTTP_URL?.replace(/\/$/, '');
  if (!base) return { state: 'unavailable', reason: 'not-configured' };

  const session = await openSession(base, userId);
  if (
    session === 'not-configured' ||
    session === 'network' ||
    session === 'http-error' ||
    session === 'malformed'
  ) {
    return { state: 'unavailable', reason: session };
  }

  try {
    const res = await fetch(`${base}/account/demo-reset`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.ok) return { state: 'accepted' };

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { state: 'unavailable', reason: 'http-error' };
    }

    const code = (body as { error?: unknown } | null)?.error;
    if (typeof code !== 'string' || code.length === 0) {
      return { state: 'unavailable', reason: 'malformed' };
    }

    return {
      state: 'refused',
      reason: RESET_REFUSALS.includes(code) ? (code as ResetRefusal) : null,
      raw: code,
    };
  } catch {
    return { state: 'unavailable', reason: 'network' };
  }
}
