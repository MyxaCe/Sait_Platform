import type { OperatorRole } from './session';

/**
 * Узкий периметр роли (поддержка, 10.11). Для ролей из этого списка ВСЕ
 * страницы и `/api`, кроме перечисленных, закрыты на входе (middleware):
 * страница → редирект на «домашнюю» раздела, `/api` → 403. Это fail-closed
 * поверх рельса: пункта нет в навигации И адрес не открывается вручную.
 *
 * Зачем на входе, а не на каждой странице: большинство страниц центра
 * управления (клиенты, KYC, AML, журнал) проверяют только наличие сессии —
 * они написаны до появления роли без доступа к ним. Один гейт здесь
 * закрывает их все разом и не размазывает правку по чужим экранам.
 *
 * Edge-совместим (без node:*): используется в middleware.
 */
export interface RoleScope {
  home: string;
  allow: readonly string[];
}

export const NARROW_ROLE_SCOPE: Partial<Record<OperatorRole, RoleScope>> = {
  support_operator: { home: '/support', allow: ['/support', '/enroll', '/api/support', '/api/health'] },
};

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** `null` — путь открыт для роли; иначе — куда увести (страница) / отказать (api). */
export function scopeViolation(role: OperatorRole, pathname: string): RoleScope | null {
  const scope = NARROW_ROLE_SCOPE[role];
  if (!scope) return null;
  return scope.allow.some((p) => under(pathname, p)) ? null : scope;
}

/** Действия вне периметра роли (server actions можно вызвать с любой страницы). */
export function isNarrowRole(role: OperatorRole): boolean {
  return NARROW_ROLE_SCOPE[role] !== undefined;
}
