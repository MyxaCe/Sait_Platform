import type { Queryable } from './db';
import type { AccountKind, LeverageBody } from './terminal-contract';
import type { LeverageOutcome } from './terminal-money';

/**
 * ПЛЕЧО СЧЁТА ДЛЯ ТЕРМИНАЛА (Р-446) — закон разрешения и его доставка.
 *
 * Закон переехал сюда из `apps/admin/lib/leverage/resolve.ts` (тот модуль
 * теперь реэкспортирует его): действующее плечо клиента считают ДВА
 * приложения — админка (при смене портфеля/override зовёт терминал) и
 * кабинет (кладёт итог в SSO-токен). Две копии закона — риск их
 * расхождения, ровно то, от чего резолвер и выносили в одну функцию.
 *
 * Приоритет (Р-446, дословно):
 *   override клиента  ›  override класса в портфеле  ›  плечо портфеля
 *
 * Плечо — ЗНАМЕНАТЕЛЬ 1:N (целое ≥ 1): 1:20 → 20.
 */

/** Откуда взялось действующее плечо — для снимка, показа и аудита. */
export type LeverageSource = 'client-override' | 'class-override' | 'portfolio';

/** Портфель плеча: база + его class-override'ы (WEB-44/45). */
export interface PortfolioLeverage {
  readonly key: string;
  readonly title: string;
  /** Знаменатель 1:N базового плеча портфеля. */
  readonly baseLeverage: number;
  /**
   * Планка по классу инструмента ВНУТРИ портфеля (WEB-45): класс → знаменатель.
   * Единственное место, где класс ещё нужен (Р-446). Пусто — класс-override нет.
   */
  readonly classOverrides: Readonly<Record<string, number>>;
}

/**
 * Override клиента (WEB-46) — по заявке, с основанием. `null` поля override у
 * клиента означают «override нет», разрешение падает к классу/портфелю.
 */
export interface ClientLeverageOverride {
  /** Знаменатель 1:N, назначенный клиенту по заявке. */
  readonly leverage: number;
  readonly reason: string;
  readonly ticket: string;
}

/** Вход резолва: портфель клиента, его override (если есть), класс инструмента. */
export interface ResolveInput {
  readonly portfolio: PortfolioLeverage;
  /** Override клиента или `null`, если не выдан. */
  readonly clientOverride: ClientLeverageOverride | null;
  /**
   * Класс инструмента, для которого считаем плечо (`'crypto'`, `'fx'`, …), или
   * `null` — тогда class-override не рассматривается и действует база портфеля
   * (или override клиента, если он есть: override клиента классу не подчинён).
   */
  readonly instrumentClass: string | null;
}

/** Итог резолва — он же payload снимка плеча. */
export interface ResolvedLeverage {
  /** Действующий знаменатель 1:N. */
  readonly leverage: number;
  readonly source: LeverageSource;
  /** Класс, по которому сработал class-override; иначе `null`. */
  readonly instrumentClass: string | null;
  readonly portfolioKey: string;
}

/**
 * ЕДИНСТВЕННОЕ место, где решается, какое плечо действует. Приоритет Р-446:
 * override клиента перекрывает всё (он выдан адресно и по заявке); иначе —
 * class-override портфеля, если класс известен и планка по нему задана; иначе
 * — база портфеля.
 *
 * Override клиента НЕ подчинён классу сознательно (Р-446): он выдаётся
 * клиенту, а не классу; адресное решение оператора важнее планки класса.
 */
export function resolveLeverage(input: ResolveInput): ResolvedLeverage {
  const { portfolio, clientOverride, instrumentClass } = input;

  if (clientOverride) {
    return {
      leverage: clientOverride.leverage,
      source: 'client-override',
      instrumentClass: null,
      portfolioKey: portfolio.key,
    };
  }

  if (instrumentClass && Object.prototype.hasOwnProperty.call(portfolio.classOverrides, instrumentClass)) {
    return {
      leverage: portfolio.classOverrides[instrumentClass]!,
      source: 'class-override',
      instrumentClass,
      portfolioKey: portfolio.key,
    };
  }

  return {
    leverage: portfolio.baseLeverage,
    source: 'portfolio',
    instrumentClass: null,
    portfolioKey: portfolio.key,
  };
}

/**
 * Класс инструментов терминала — ОДИН на все инструменты, и это решение, а не
 * упрощение по забывчивости.
 *
 * Терминал торгует только парами Binance — это крипта целиком; отображения
 * «символ → класс» нет ни в терминале, ни в CMS. Поэтому плечо счёта в
 * терминале одно число на счёт: итог закона для класса `crypto`. Значит
 * крипто-override портфеля (Standard: база 1:20, крипта 1:10) действует на
 * ВСЕ инструменты терминала, а смена базы портфеля, у которого есть
 * крипто-override, на торговлю не влияет вовсе.
 *
 * Появится второй класс (fx, акции) — терминалу понадобится класс у
 * инструмента и плечо по классу; тогда сюда приедет спецификация, а не одно
 * число.
 */
export const TERMINAL_INSTRUMENT_CLASS = 'crypto';

export const MIN_TERMINAL_LEVERAGE = 1;
/** Верхняя граница терминала (`broker::MAX_LEVERAGE`). */
export const MAX_TERMINAL_LEVERAGE = 1000;

function denominator(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * Действующее плечо счёта терминала для каждого из `userIds` — по состоянию
 * `db` (внутри транзакции — с её же незакоммиченными правками).
 *
 * Клиент без строки `client_leverage` сидит в портфеле по умолчанию. Нет ни
 * строки, ни портфеля по умолчанию — клиента в ответе НЕТ: плечо не задано
 * конфигурацией, и выдумывать его здесь нельзя (терминал тогда держит своё —
 * последнее назначенное или плечо площадки).
 */
export async function readTerminalLeverage(
  db: Queryable,
  userIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (userIds.length === 0) return out;

  const clients = await db.query(
    `SELECT u.id::text AS user_id, cl.portfolio_key, cl.override_leverage
       FROM users u
       LEFT JOIN client_leverage cl ON cl.user_id = u.id
      WHERE u.id::text = ANY($1::text[])`,
    [userIds],
  );
  const portfolios = await db.query(`SELECT key, title, base_leverage, is_default FROM leverage_portfolios`);
  const classRows = await db.query(
    `SELECT portfolio_key, leverage FROM leverage_portfolio_class_overrides WHERE instrument_class = $1`,
    [TERMINAL_INSTRUMENT_CLASS],
  );

  const classByPortfolio = new Map<string, number>();
  for (const r of classRows.rows) {
    const lev = denominator(r.leverage);
    if (lev !== null) classByPortfolio.set(String(r.portfolio_key), lev);
  }
  const byKey = new Map<string, PortfolioLeverage>();
  let defaultKey: string | null = null;
  for (const r of portfolios.rows) {
    const key = String(r.key);
    const base = denominator(r.base_leverage);
    if (base === null) continue;
    const cls = classByPortfolio.get(key);
    byKey.set(key, {
      key,
      title: String(r.title ?? key),
      baseLeverage: base,
      classOverrides: cls === undefined ? {} : { [TERMINAL_INSTRUMENT_CLASS]: cls },
    });
    if (r.is_default === true && (defaultKey === null || key < defaultKey)) defaultKey = key;
  }

  for (const r of clients.rows) {
    const portfolioKey = r.portfolio_key === null || r.portfolio_key === undefined ? defaultKey : String(r.portfolio_key);
    const portfolio = portfolioKey ? byKey.get(portfolioKey) : undefined;
    if (!portfolio) continue;
    const override = denominator(r.override_leverage);
    const resolved = resolveLeverage({
      portfolio,
      clientOverride: override === null ? null : { leverage: override, reason: '', ticket: '' },
      instrumentClass: TERMINAL_INSTRUMENT_CLASS,
    });
    out.set(String(r.user_id), resolved.leverage);
  }
  return out;
}

/**
 * Клиенты портфеля: явно в него посаженные И — если портфель по умолчанию —
 * все, у кого строки `client_leverage` нет (они сидят в нём неявно). Без
 * второй половины смена портфеля по умолчанию обошла бы ровно большинство.
 */
export async function clientsOfPortfolio(db: Queryable, portfolioKey: string): Promise<string[]> {
  const res = await db.query(
    `SELECT u.id::text AS user_id
       FROM users u
       LEFT JOIN client_leverage cl ON cl.user_id = u.id
      WHERE cl.portfolio_key = $1
         OR (cl.user_id IS NULL
             AND EXISTS (SELECT 1 FROM leverage_portfolios p WHERE p.key = $1 AND p.is_default))
      ORDER BY u.id`,
    [portfolioKey],
  );
  return res.rows.map((r) => String(r.user_id));
}

/** Изменение действующего плеча одного клиента. */
export interface LeverageChange {
  userId: string;
  /** Было по сайту; `null` — конфигурация плеча не задавала. */
  before: number | null;
  after: number;
}

/** Только те, у кого действующее плечо действительно поменялось. */
export function leverageChanges(before: Map<string, number>, after: Map<string, number>): LeverageChange[] {
  const out: LeverageChange[] = [];
  for (const [userId, lev] of after) {
    const was = before.get(userId) ?? null;
    if (was !== lev) out.push({ userId, before: was, after: lev });
  }
  return out;
}

/** Применённое в терминале (для журнала и отката). */
export interface AppliedLeverage {
  userId: string;
  kind: AccountKind;
  leverage: number;
  /** Действующее плечо счёта в терминале ДО вызова (для отката). */
  previous: number | null;
  changed: boolean;
  seq: number | null;
}

export type LeverageSyncResult =
  | { ok: true; applied: AppliedLeverage[]; notOpened: number }
  | { ok: false; reason: 'terminalUnavailable'; userId: string; compensationFailed: number }
  | { ok: false; reason: 'terminalRefused'; code: string; userId: string; compensationFailed: number };

/** Клиент терминала, умеющий назначать плечо (см. `terminal-money.ts`). */
export interface TerminalLeverageClient {
  setLeverage(userId: string, body: LeverageBody, kind: AccountKind): Promise<LeverageOutcome>;
}

const KINDS: readonly AccountKind[] = ['demo', 'real'];

/**
 * Довезти изменения плеча до терминала — оба счёта клиента (демо и реальный).
 *
 * **fail-closed.** Первый же отказ или «не знаем» останавливает доставку, и
 * всё, что уже применено этим вызовом, откатывается обратно (на плечо,
 * которое терминал сам назвал «до»). Вызывающий откатывает свою транзакцию —
 * в итоге не меняется ни сайт, ни терминал. Откат сам может не дойти
 * (терминал лёг посреди) — тогда `compensationFailed > 0`, и это надо
 * сказать оператору: терминал впереди сайта, повтор той же формы его догонит.
 *
 * Счёт, которого в терминале нет (`not-opened`: человек ни разу не входил
 * этим родом счёта), — не ошибка: своё плечо он получит claim-ом при первом
 * входе.
 */
export async function pushLeverageToTerminal(
  terminal: TerminalLeverageClient,
  changes: readonly LeverageChange[],
  meta: { reason: string; operator: string; externalRef?: string },
): Promise<LeverageSyncResult> {
  const applied: AppliedLeverage[] = [];
  let notOpened = 0;

  async function compensate(): Promise<number> {
    let failed = 0;
    for (const a of [...applied].reverse()) {
      if (!a.changed || a.previous === null) continue;
      const back = await terminal
        .setLeverage(
          a.userId,
          {
            leverage: a.previous,
            reason: `откат: изменение плеча не применено на сайте (${meta.reason})`,
            operator: meta.operator,
            ...(meta.externalRef ? { external_ref: meta.externalRef } : {}),
          },
          a.kind,
        )
        .catch(() => ({ state: 'unavailable' as const, reason: 'network' as const }));
      if (back.state !== 'ok') failed += 1;
    }
    return failed;
  }

  for (const change of changes) {
    for (const kind of KINDS) {
      const out = await terminal
        .setLeverage(
          change.userId,
          {
            leverage: change.after,
            reason: meta.reason,
            operator: meta.operator,
            ...(meta.externalRef ? { external_ref: meta.externalRef } : {}),
          },
          kind,
        )
        .catch(() => ({ state: 'unavailable' as const, reason: 'network' as const }));
      if (out.state === 'ok') {
        applied.push({
          userId: change.userId,
          kind,
          leverage: change.after,
          previous: out.previousLeverage,
          changed: out.changed,
          seq: out.seq,
        });
        continue;
      }
      if (out.state === 'not-opened') {
        notOpened += 1;
        continue;
      }
      const compensationFailed = await compensate();
      if (out.state === 'refused') {
        return { ok: false, reason: 'terminalRefused', code: out.code, userId: change.userId, compensationFailed };
      }
      return { ok: false, reason: 'terminalUnavailable', userId: change.userId, compensationFailed };
    }
  }
  return { ok: true, applied, notOpened };
}
