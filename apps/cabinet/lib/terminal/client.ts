import { issueHandoffToken, tenantSlug } from '@/lib/sso/jwt';
import { parseClosedDeals, type ClosedDeal } from './closed-deals';

/**
 * Чтение истории сделок у терминала (CAB-09).
 *
 * **Почему HTTP, а не шина.** Уведомление должно приходить само, и это
 * событие (`TRM-40`). История — это запрос: человек открыл страницу и
 * спросил. Ручка `/deals/closed` уже существует, и уровень с признаком
 * разрыва есть именно в ней.
 *
 * **Как мы туда попадаем.** Ручка требует сессию терминала, а сессию
 * терминал чеканит в обмен на наш же handoff-JWT — мы его эмитент. То
 * есть новых механизмов не заводится: `issueHandoffToken` → `/v1/session`
 * → `Bearer`. Токен одноразовый по `jti`, поэтому выпускается на каждый
 * запрос истории, как и при входе в терминал.
 *
 * **Адрес здесь СЕРВЕРНЫЙ и отдельный от браузерного.** `NEXT_PUBLIC_…`
 * впекается на сборке и указывает туда, куда ходит браузер
 * (`localhost:8888`); из контейнера этот адрес ведёт в никуда. Поэтому
 * `TERMINAL_HTTP_URL` — обычная переменная окружения, по образцу
 * `MDS_HTTP_URL` рядом с `NEXT_PUBLIC_WS_URL`.
 *
 * **Ось отказа — канальная, та же, что у каталога MDS:** `not-configured`
 * · `network` · `http-error` · `malformed`. Разные неполадки у разных
 * людей; схлопнутые, они отправляют чинить наугад (Р-070).
 */
export type TerminalFailure = 'not-configured' | 'network' | 'http-error' | 'malformed';

export type ClosedDealsOutcome =
  | { state: 'available'; deals: ClosedDeal[] }
  | { state: 'unavailable'; reason: TerminalFailure };

const TIMEOUT_MS = 3_000;

async function openSession(base: string, userId: string): Promise<string | TerminalFailure> {
  const handoff = await issueHandoffToken(userId);
  try {
    const res = await fetch(`${base}/v1/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: handoff.token, site: tenantSlug() }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return 'http-error';

    // Разбор тела — в своём `try`: нечитаемый JSON иначе улетел бы во
    // внешний `catch` и назвался бы «не дозвонились».
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

export async function getClosedDeals(userId: string): Promise<ClosedDealsOutcome> {
  const base = process.env.TERMINAL_HTTP_URL?.replace(/\/$/, '');
  if (!base) return { state: 'unavailable', reason: 'not-configured' };

  const session = await openSession(base, userId);
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

    // Пустой список — законный ответ: сделок не было. Это НЕ отказ, и
    // путать «сделок нет» с «историю не получили» нельзя: первое человек
    // читает как факт о себе, второе — как нашу неполадку.
    if (!Array.isArray(body)) return { state: 'unavailable', reason: 'malformed' };
    return { state: 'available', deals: parseClosedDeals(body) };
  } catch {
    return { state: 'unavailable', reason: 'network' };
  }
}

/**
 * Отказы сброса, названные ТЕРМИНАЛОМ (`TRM-54`).
 *
 * Отдельная ось от канальной: канальная говорит, почему мы не дошли,
 * эта — почему операция не делается. Схлопнуть их значило бы сказать
 * человеку «не получилось» там, где терминал сказал «нельзя, и вот
 * почему».
 */
export type ResetRefusal =
  /** Настоящие деньги к «стартовой сумме» не сбрасывают: её там нет. */
  | 'not_a_demo_account'
  /** Есть открытые позиции. Закрыть их самим нельзя: закрытие — сделка
   *  с ценой и результатом, а её никто не просил. */
  | 'account_not_flat';

export type ResetOutcome =
  /** Терминал принял. Баланс изменится, когда приедет событие шины. */
  | { state: 'accepted' }
  /** Терминал отказал по существу, с названной причиной. */
  | { state: 'refused'; reason: ResetRefusal | null; raw: string | null }
  /** До терминала не дошли или не поняли ответ. */
  | { state: 'unavailable'; reason: TerminalFailure };

const RESET_REFUSALS: readonly string[] = ['not_a_demo_account', 'account_not_flat'];

/**
 * Сброс демо-счёта (WEB-29). **Операция терминала, не наша.**
 *
 * > Владелец денежного числа — терминал. Кабинет — проекция.
 *
 * Прежде кабинет правил свою копию сам, и следующее же событие о
 * балансе возвращало прежнюю сумму — **сброс отменялся сам**. Теперь
 * он идёт обычным путём мутации счёта, а к нам возвращается событием.
 *
 * **Поэтому «принято» — не «применено».** Баланс обновится, когда
 * приедет `terminal.balance.changed` с причиной `reset`. Показывать
 * новую сумму сразу значило бы утверждать результат, которого мы ещё
 * не видели, — и это ровно то, на чём ломался прежний сброс.
 */
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

    // Отказ по существу приходит телом с кодом. Не разобрали — это
    // `malformed`, а НЕ «отказано без причины»: вторая формулировка
    // утверждала бы, что терминал причины не назвал.
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

    // Незнакомый код сохраняется сырым: терминал мог завести причину
    // раньше, чем мы о ней узнали, и молчать о ней хуже, чем показать
    // общий текст (WEB-26).
    return {
      state: 'refused',
      reason: RESET_REFUSALS.includes(code) ? (code as ResetRefusal) : null,
      raw: code,
    };
  } catch {
    return { state: 'unavailable', reason: 'network' };
  }
}
