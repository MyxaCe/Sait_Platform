import type { OperatorRole } from './session';
import { canAccessPath, homeFor } from '@/components/shell/sections';

export interface RoleScope {
  home: string;
}

export function scopeViolation(role: OperatorRole, pathname: string): RoleScope | null {
  return canAccessPath(role, pathname) ? null : { home: homeFor(role) };
}
