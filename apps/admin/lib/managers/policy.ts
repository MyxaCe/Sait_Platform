import type { OperatorRole } from '@/lib/auth/session';
import { canAccessSection } from '@/components/shell/sections';

/**
 * Правила «менеджеров клиентов» (ДЕМО-менеджеры, 10.11). Client-safe: без `pg`.
 *
 * **Менеджер — не роль, а ответственность** (ADR Ф1 в
 * `_brain/ДЕМО-менеджеры-перевод-правка-дизайн.md`). Роль решает «какие разделы
 * открыты» (матрица `sections.ts`), закрепление — «за чьими клиентами человек
 * следит». Поэтому:
 *  - быть менеджером может только роль, которой открыт раздел «Клиенты»
 *    (admin, operator, finance_operator) — иначе менеджер не открыл бы карточку
 *    своего клиента; support_operator — нет;
 *  - флаг «менеджер клиентов» и закрепление ставит/снимает только admin
 *    (старшего менеджера в матрице нет; появится — расширяется здесь одной
 *    строкой, вопрос владельцу в ADR);
 *  - закрепление прав НЕ расширяет: менеджер видит в карточке ровно то, что
 *    разрешает его роль.
 */

/** Может ли роль в принципе быть менеджером клиентов (видит раздел «Клиенты»). */
export function roleCanManageClients(role: OperatorRole | null | undefined): boolean {
  return canAccessSection(role, 'clients');
}

/** Кто назначает менеджеров и ставит флаг «менеджер клиентов». */
export function canAssignManagers(role: OperatorRole | null | undefined): boolean {
  return role === 'admin';
}

/** Потолок массового назначения за одну операцию (одна транзакция, одна страница реестра ×4). */
export const BULK_ASSIGN_LIMIT = 200;

/**
 * Фильтр реестра по менеджеру (`?mgr=`): все, «мои», без менеджера или
 * конкретный менеджер по id. Неизвестное — к умолчанию (ссылка со старым
 * параметром не ломает страницу).
 */
export type ManagerFilter = 'all' | 'mine' | 'none' | { managerId: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

export function parseManagerFilter(raw: string, fallback: 'all' | 'mine'): ManagerFilter {
  if (raw === 'all' || raw === 'mine' || raw === 'none') return raw;
  if (isUuid(raw)) return { managerId: raw.toLowerCase() };
  return fallback;
}

/** Значение фильтра для URL / `<select>`. */
export function managerFilterValue(f: ManagerFilter): string {
  return typeof f === 'string' ? f : f.managerId;
}

export function sameManagerFilter(a: ManagerFilter, b: ManagerFilter): boolean {
  return managerFilterValue(a) === managerFilterValue(b);
}
