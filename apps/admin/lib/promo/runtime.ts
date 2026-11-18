import type { OperatorRole } from '../auth/session';
import { canAccessSection } from '@/components/shell/sections';

export function canViewPromo(role: OperatorRole | null | undefined): boolean {
  return canAccessSection(role, 'promo');
}

export function canManagePromo(role: OperatorRole | null | undefined): boolean {
  return role === 'admin';
}
