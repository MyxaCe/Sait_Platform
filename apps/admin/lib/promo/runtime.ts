import type { OperatorRole } from '../auth/session';
import { canAccessSection } from '@/components/shell/sections';

/**
 * Роли зоны «Акции и партнёры» (fail-closed):
 *  - видеть раздел и решать очередь начислений — admin и finance_operator
 *    (начисление — денежное действие, как «Деньги»);
 *  - создавать/менять акции, подводить итоги, переназначать рефералов, вести
 *    IB-партнёров — только admin (дизайн §3.4).
 */
export function canViewPromo(role: OperatorRole | null | undefined): boolean {
  // Тот же список, что раздел «Акции» в матрице (components/shell/sections.ts).
  return canAccessSection(role, 'promo');
}

export function canManagePromo(role: OperatorRole | null | undefined): boolean {
  return role === 'admin';
}
