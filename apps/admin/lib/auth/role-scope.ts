import type { OperatorRole } from './session';
import { canAccessPath, homeFor } from '@/components/shell/sections';

/**
 * Гейт роли на ВХОДЕ (middleware) — поверх матрицы `components/shell/sections.ts`.
 * Для каждой роли страницы и `/api` вне её разделов закрыты: страница →
 * редирект на «домашнюю» роли, `/api` → 403. Fail-closed поверх рельса: пункта
 * нет в навигации И адрес не открывается вручную.
 *
 * Раньше (поддержка, 10.11) так закрывалась только узкая роль support_operator,
 * а страницы «Клиенты», «KYC», «AML», «Журнал» проверяли лишь наличие сессии —
 * finance_operator открывал KYC по прямому адресу. Теперь правило одно для всех
 * ролей; layout раздела и server actions перепроверяют ту же матрицу (и-и).
 *
 * Edge-совместим (без node:*): используется в middleware.
 */
export interface RoleScope {
  home: string;
}

/** `null` — путь открыт для роли; иначе — куда увести (страница) / отказать (api). */
export function scopeViolation(role: OperatorRole, pathname: string): RoleScope | null {
  return canAccessPath(role, pathname) ? null : { home: homeFor(role) };
}
