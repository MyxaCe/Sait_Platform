import type { OperatorRole } from '@/lib/auth/session';
import { canAccessSection } from '@/components/shell/sections';

export function roleCanManageClients(role: OperatorRole | null | undefined): boolean {
  return canAccessSection(role, 'clients');
}

export function canAssignManagers(role: OperatorRole | null | undefined): boolean {
  return role === 'admin';
}

export const BULK_ASSIGN_LIMIT = 200;

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

export function managerFilterValue(f: ManagerFilter): string {
  return typeof f === 'string' ? f : f.managerId;
}

export function sameManagerFilter(a: ManagerFilter, b: ManagerFilter): boolean {
  return managerFilterValue(a) === managerFilterValue(b);
}
