/**
 * Словарь ручного AML-скрининга (ADM-14, Р-454 I-5) — client-safe модуль без
 * `pg`, чтобы форма (client component) импортировала типы/списки, не втягивая
 * серверный код и драйвер БД в браузерный бандл. Источник правды о множестве
 * статусов — CHECK в схеме (`client_aml_screening.status`); здесь — приведение
 * строки БД к известному значению fail-closed и человекочитаемые подписи.
 */

/**
 * Исход скрининга. `unscreened` — ещё не сводили (нет строки / COALESCE);
 * `clear` — проверено, совпадений нет; `escalated` — найдено → эскалация.
 */
export type AmlStatus = 'unscreened' | 'clear' | 'escalated';

/** Исход, который фиксирует оператор (из `unscreened` не фиксируют — это дефолт). */
export type AmlOutcome = 'clear' | 'escalated';

export const AML_STATUSES: readonly AmlStatus[] = ['unscreened', 'clear', 'escalated'];

export const AML_STATUS_LABELS: Record<AmlStatus, string> = {
  unscreened: 'Не сверялся',
  clear: 'Проверено, совпадений нет',
  escalated: 'Найдено — эскалация',
};

/** Приводим строку БД к известному статусу или бросаем (fail-closed). */
export function asAmlStatus(value: unknown): AmlStatus {
  if (value === 'unscreened' || value === 'clear' || value === 'escalated') {
    return value;
  }
  // Неизвестный статус — не «наверное ок»: строка сломана, не трактуем.
  throw new Error(`client_aml_screening.status вне допустимого множества: ${String(value)}`);
}

/**
 * Санкционные списки, по которым оператор сверяет вручную (Р-454 I-5):
 * OFSI (UK), OFAC (US), EU consolidated. Это ПЕРЕЧЕНЬ для фиксации «что
 * проверено»; КАКИЕ из них ОБЯЗАТЕЛЬНЫ — решение владельца (политика AML),
 * здесь не зашито (см. отчёт ADM-14).
 */
export type SanctionsListId = 'ofsi' | 'ofac' | 'eu';

export interface SanctionsList {
  id: SanctionsListId;
  /** Короткая подпись для чекбокса/бейджа. */
  label: string;
  /** Орган, ведущий список. */
  authority: string;
}

export const SANCTIONS_LISTS: readonly SanctionsList[] = [
  { id: 'ofsi', label: 'OFSI', authority: 'HM Treasury (UK)' },
  { id: 'ofac', label: 'OFAC', authority: 'US Treasury' },
  { id: 'eu', label: 'EU consolidated', authority: 'European Union' },
];

/**
 * Списки, ОБЯЗАТЕЛЬНЫЕ для исхода «clear» (Р-456 D): все три — OFSI, OFAC и
 * EU consolidated. Отметка «совпадений нет» не принимается, пока сверка не
 * покрыла каждый из них (не «≥1 из», а «все три»). Для исхода «escalated»
 * достаточно одного списка — совпадение по любому уже требует эскалации.
 */
export const REQUIRED_LISTS_FOR_CLEAR: readonly SanctionsListId[] = ['ofsi', 'ofac', 'eu'];

const SANCTIONS_LIST_IDS: ReadonlySet<string> = new Set(SANCTIONS_LISTS.map((l) => l.id));

/** Покрывает ли набор все обязательные для «clear» списки (Р-456 D). */
export function coversAllRequiredForClear(lists: readonly SanctionsListId[]): boolean {
  return REQUIRED_LISTS_FOR_CLEAR.every((id) => lists.includes(id));
}

export function isSanctionsListId(value: unknown): value is SanctionsListId {
  return typeof value === 'string' && SANCTIONS_LIST_IDS.has(value);
}

/**
 * Отфильтровывает из входа только известные id списков, без дублей, в порядке
 * реестра (а не в порядке прихода из формы). Неизвестное молча отбрасывается —
 * фиксируем лишь то, что есть в реестре (fail-closed относительно множества).
 */
export function normalizeSanctionsLists(values: readonly unknown[]): SanctionsListId[] {
  const picked = new Set<SanctionsListId>();
  for (const v of values) {
    if (isSanctionsListId(v)) picked.add(v);
  }
  return SANCTIONS_LISTS.map((l) => l.id).filter((id) => picked.has(id));
}

export function sanctionsListLabel(id: SanctionsListId): string {
  return SANCTIONS_LISTS.find((l) => l.id === id)?.label ?? id;
}
