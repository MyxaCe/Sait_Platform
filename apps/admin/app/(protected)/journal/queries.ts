import { getPool, type Queryable } from '@/lib/db';
import type { OperatorRole } from '@/lib/auth/session';
import type { ChainRow } from './verify-chain';

/**
 * Чтения журнала/аудита (ADM-06, Р-049, Р-395).
 *
 * Журнал неизменяем базой и только дополняется (`appendJournalEntry`). Этот
 * модуль — ТОЛЬКО чтение: лента с фильтрами (для экрана) и полная выгрузка
 * цепочки по возрастанию `seq` (для проверки целостности).
 *
 * **Формат времени.** `occurred_at` в хеше записи — это ISO-строка из
 * `new Date().toISOString()` (мс + 'Z'), и в таблицу она пишется явно (а не
 * через `DEFAULT now()`), см. `journal.ts`. Драйвер `pg` отдаёт `timestamptz`
 * как `Date`; `new Date(value).toISOString()` возвращает ровно тот же вид
 * (JS-дата — миллисекундная, 'Z'), поэтому пересчёт хеша сходится с записью.
 *
 * **Роль-гейт чтения (fail-closed, Р-394).** `admin` видит все записи. `operator`
 * видит свои (`operator_id = сам`) и ОБЩИЕ операционные (`subject_kind <>
 * 'operator'` — записи о клиентах/деньгах/плече), но НЕ приватные записи об
 * ИНЫХ операторах (вход, провижининг, смена роли). Проверку цепочки и экспорт
 * запускает только `admin` (см. `actions.ts`).
 */

export interface JournalRow {
  seq: number;
  /** ISO-строка в формате `new Date().toISOString()` (мс, 'Z'). */
  occurredAt: string;
  operatorId: string;
  operatorLogin: string;
  operatorName: string;
  action: string;
  subjectKind: string;
  subjectId: string;
  payload: Record<string, unknown>;
  prevHash: string | null;
  entryHash: string;
}

export interface JournalFilters {
  /** `operators.id`. */
  operatorId?: string;
  /** Точное совпадение `action`. */
  action?: string;
  /** Род субъекта (`client`, `operator`, `journal`, …). */
  subjectKind?: string;
  /** Идентификатор субъекта (точное совпадение). */
  subjectId?: string;
  /** Нижняя граница периода (ISO/`YYYY-MM-DD`). */
  from?: string;
  /** Верхняя граница периода (ISO/`YYYY-MM-DD`). */
  to?: string;
}

export interface JournalListOptions {
  role: OperatorRole;
  selfOperatorId: string;
  filters: JournalFilters;
  /** Потолок строк (по умолчанию 500 для ленты). */
  limit?: number;
  /** Пропустить строк (постраничный показ). */
  offset?: number;
}

/** Опция фильтра «оператор». */
export interface OperatorOption {
  id: string;
  login: string;
  displayName: string;
}

function toRow(r: Record<string, unknown>): JournalRow {
  return {
    seq: Number(r.seq),
    occurredAt: new Date(r.occurred_at as string | Date).toISOString(),
    operatorId: r.operator_id as string,
    operatorLogin: r.operator_login as string,
    operatorName: r.operator_name as string,
    action: r.action as string,
    subjectKind: r.subject_kind as string,
    subjectId: r.subject_id as string,
    payload: (r.payload as Record<string, unknown> | null) ?? {},
    prevHash: (r.prev_hash as string | null) ?? null,
    entryHash: r.entry_hash as string,
  };
}

/**
 * WHERE ленты: роль-видимость + фильтры. Клаузы собираются параметризованно —
 * конкатенации пользовательского ввода в SQL нет. Общий для ленты и счётчика,
 * чтобы «Показано N из M» считалось ровно по той же выборке.
 */
function buildWhere(opts: Pick<JournalListOptions, 'role' | 'selfOperatorId' | 'filters'>): {
  whereSql: string;
  params: unknown[];
} {
  const params: unknown[] = [];
  const where: string[] = [];

  // Роль-видимость: admin — всё; operator — свои + общие (не про операторов).
  if (opts.role !== 'admin') {
    params.push(opts.selfOperatorId);
    where.push(`(j.operator_id = $${params.length} OR j.subject_kind <> 'operator')`);
  }

  const f = opts.filters;
  if (f.operatorId) {
    params.push(f.operatorId);
    where.push(`j.operator_id = $${params.length}`);
  }
  if (f.action) {
    // `префикс.*` — все действия группы (фильтр «правки учётных данных» для
    // службы безопасности); иначе точное совпадение. Префикс — из [a-z_.]
    // (код действия), `_` экранируется для LIKE.
    const prefix = f.action.endsWith('.*') ? f.action.slice(0, -1) : null;
    if (prefix !== null && /^[a-z_.]+$/.test(prefix)) {
      params.push(`${prefix.replaceAll('_', '\\_')}%`);
      where.push(`j.action LIKE $${params.length}`);
    } else {
      params.push(f.action);
      where.push(`j.action = $${params.length}`);
    }
  }
  if (f.subjectKind) {
    params.push(f.subjectKind);
    where.push(`j.subject_kind = $${params.length}`);
  }
  if (f.subjectId) {
    params.push(f.subjectId);
    where.push(`j.subject_id = $${params.length}`);
  }
  if (f.from) {
    params.push(f.from);
    where.push(`j.occurred_at >= $${params.length}`);
  }
  if (f.to) {
    params.push(f.to);
    where.push(`j.occurred_at <= $${params.length}`);
  }

  return { whereSql: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '', params };
}

/**
 * Лента журнала с фильтрами и роль-видимостью. Новые сверху (`seq DESC`).
 * `offset` — для постраничного показа (экспорт его не передаёт).
 */
export async function listJournalEntries(
  opts: JournalListOptions,
  db: Queryable = getPool(),
): Promise<JournalRow[]> {
  const { whereSql, params } = buildWhere(opts);
  const limit = Math.max(1, Math.min(opts.limit ?? 500, 100_000));
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));

  const result = await db.query(
    `SELECT j.seq, j.occurred_at, j.operator_id, j.action, j.subject_kind, j.subject_id,
            j.payload, j.prev_hash, j.entry_hash,
            o.login AS operator_login, o.display_name AS operator_name
       FROM admin_action_journal j
       JOIN operators o ON o.id = j.operator_id
       ${whereSql}
      ORDER BY j.seq DESC
      LIMIT ${limit}${offset > 0 ? ` OFFSET ${offset}` : ''}`,
    params,
  );
  return result.rows.map(toRow);
}

/** Сколько записей в выборке (та же роль-видимость и фильтры, что у ленты). */
export async function countJournalEntries(
  opts: Pick<JournalListOptions, 'role' | 'selfOperatorId' | 'filters'>,
  db: Queryable = getPool(),
): Promise<number> {
  const { whereSql, params } = buildWhere(opts);
  const result = await db.query(
    `SELECT COUNT(*)::int AS n FROM admin_action_journal j ${whereSql}`,
    params,
  );
  return Number(result.rows[0]?.n ?? 0);
}

/** Сводка цепочки для шапки раздела: всего записей, последняя seq и её момент. */
export interface JournalTotals {
  total: number;
  lastSeq: number | null;
  lastAt: string | null;
}

export async function getJournalTotals(db: Queryable = getPool()): Promise<JournalTotals> {
  const result = await db.query(
    `SELECT COUNT(*)::int AS n, MAX(seq) AS last_seq, MAX(occurred_at) AS last_at
       FROM admin_action_journal`,
  );
  const r = result.rows[0] ?? {};
  return {
    total: Number(r.n ?? 0),
    lastSeq: r.last_seq == null ? null : Number(r.last_seq),
    lastAt: r.last_at ? new Date(r.last_at as string | Date).toISOString() : null,
  };
}

/**
 * Человеческие имена субъектов на странице ленты: клиент → ФИО, оператор →
 * имя, портфель → название. Ключ — `${kind}:${id}`. Только чтение
 * справочников, журнал не трогает; чего не нашли — того в карте нет
 * (показываем id).
 */
export async function resolveSubjectNames(
  rows: Pick<JournalRow, 'subjectKind' | 'subjectId'>[],
  db: Queryable = getPool(),
): Promise<Map<string, string>> {
  const ids = (kind: string) => [
    ...new Set(rows.filter((r) => r.subjectKind === kind).map((r) => r.subjectId)),
  ];
  const clients = ids('client');
  const operators = ids('operator');
  const portfolios = ids('leverage_portfolio');
  const out = new Map<string, string>();

  const [c, o, p] = await Promise.all([
    clients.length
      ? db.query(`SELECT id::text AS id, full_name AS name FROM users WHERE id::text = ANY($1)`, [
          clients,
        ])
      : null,
    operators.length
      ? db.query(
          `SELECT id::text AS id, display_name AS name FROM operators WHERE id::text = ANY($1)`,
          [operators],
        )
      : null,
    portfolios.length
      ? db.query(`SELECT key AS id, title AS name FROM leverage_portfolios WHERE key = ANY($1)`, [
          portfolios,
        ])
      : null,
  ]);
  const pairs: [string, { rows: Record<string, unknown>[] } | null][] = [
    ['client', c],
    ['operator', o],
    ['leverage_portfolio', p],
  ];
  for (const [kind, res] of pairs) {
    for (const row of res?.rows ?? []) out.set(`${kind}:${String(row.id)}`, String(row.name));
  }
  return out;
}

/**
 * Полная цепочка по возрастанию `seq` для проверки целостности — БЕЗ фильтров
 * и БЕЗ роль-видимости: цепочка линейна по всему журналу, проверять её имеет
 * смысл только целиком. Вызывается лишь из admin-экшена (`actions.ts`).
 */
export async function loadChainRows(db: Queryable = getPool()): Promise<ChainRow[]> {
  const result = await db.query(
    `SELECT seq, occurred_at, operator_id, action, subject_kind, subject_id,
            payload, prev_hash, entry_hash
       FROM admin_action_journal
      ORDER BY seq ASC`,
  );
  return result.rows.map((r) => ({
    seq: Number(r.seq),
    occurredAt: new Date(r.occurred_at as string | Date).toISOString(),
    operatorId: r.operator_id as string,
    action: r.action as string,
    subjectKind: r.subject_kind as string,
    subjectId: r.subject_id as string,
    payload: (r.payload as Record<string, unknown> | null) ?? {},
    prevHash: (r.prev_hash as string | null) ?? null,
    entryHash: r.entry_hash as string,
  }));
}

/** Операторы для выпадающего фильтра (id + подпись). */
export async function listOperatorsForFilter(db: Queryable = getPool()): Promise<OperatorOption[]> {
  const result = await db.query(
    `SELECT id, login, display_name FROM operators ORDER BY display_name ASC`,
  );
  return result.rows.map((r) => ({
    id: r.id as string,
    login: r.login as string,
    displayName: r.display_name as string,
  }));
}

/** Встречающиеся в журнале типы действий — для фильтра. */
export async function listDistinctActions(db: Queryable = getPool()): Promise<string[]> {
  const result = await db.query(
    `SELECT DISTINCT action FROM admin_action_journal ORDER BY action ASC`,
  );
  return result.rows.map((r) => r.action as string);
}

/** Встречающиеся роды субъектов — для фильтра. */
export async function listDistinctSubjectKinds(db: Queryable = getPool()): Promise<string[]> {
  const result = await db.query(
    `SELECT DISTINCT subject_kind FROM admin_action_journal ORDER BY subject_kind ASC`,
  );
  return result.rows.map((r) => r.subject_kind as string);
}
