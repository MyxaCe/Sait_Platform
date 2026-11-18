import type { OperatorRole } from '@/lib/auth/session';

export type SectionKey =
  | 'dashboard'
  | 'clients'
  | 'kyc'
  | 'aml'
  | 'support'
  | 'risk'
  | 'journal'
  | 'operators'
  | 'money'
  | 'promo'
  | 'settings';

export interface SectionAccess {
  roles: readonly OperatorRole[];
  paths: readonly string[];
  exact?: boolean;
}

export const ALL_ROLES: readonly OperatorRole[] = ['admin', 'operator', 'finance_operator', 'support_operator'];

export const SECTIONS: Record<SectionKey, SectionAccess> = {
  dashboard: { roles: ['admin', 'operator', 'finance_operator'], paths: ['/'], exact: true },
  clients: { roles: ['admin', 'operator', 'finance_operator'], paths: ['/clients'] },
  kyc: { roles: ['admin', 'operator'], paths: ['/kyc'] },
  aml: { roles: ['admin', 'operator'], paths: ['/aml'] },
  support: {
    roles: ['admin', 'operator', 'finance_operator', 'support_operator'],
    paths: ['/support', '/api/support'],
  },
  risk: { roles: ['admin', 'operator'], paths: ['/risk'] },
  journal: { roles: ['admin', 'operator', 'finance_operator'], paths: ['/journal'] },
  operators: { roles: ['admin'], paths: ['/operators'] },
  money: { roles: ['admin', 'finance_operator'], paths: ['/money'] },
  promo: { roles: ['admin', 'finance_operator'], paths: ['/promo'] },
  settings: { roles: ['admin'], paths: ['/settings'] },
};

export const SECTION_KEYS = Object.keys(SECTIONS) as SectionKey[];

export const COMMON_PATHS: readonly string[] = ['/enroll', '/api/health'];

const SECTION_HOME: Record<SectionKey, string> = {
  dashboard: '/',
  clients: '/clients',
  kyc: '/kyc',
  aml: '/aml',
  support: '/support',
  risk: '/risk/leverage',
  journal: '/journal',
  operators: '/operators',
  money: '/money',
  promo: '/promo',
  settings: '/settings',
};

function under(pathname: string, prefix: string, exact = false): boolean {
  if (exact) return pathname === prefix;
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function canAccessSection(role: OperatorRole | null | undefined, key: SectionKey): boolean {
  return role != null && SECTIONS[key].roles.includes(role);
}

export function sectionOfPath(pathname: string): SectionKey | null {
  for (const key of SECTION_KEYS) {
    const s = SECTIONS[key];
    if (s.paths.some((p) => under(pathname, p, s.exact))) return key;
  }
  return null;
}

export function canAccessPath(role: OperatorRole, pathname: string): boolean {
  if (COMMON_PATHS.some((p) => under(pathname, p))) return true;
  const key = sectionOfPath(pathname);
  if (key === null) return role === 'admin';
  return canAccessSection(role, key);
}

export function homeFor(role: OperatorRole): string {
  const key = SECTION_KEYS.find((k) => canAccessSection(role, k));
  return key ? SECTION_HOME[key] : '/enroll';
}

export function sectionHome(key: SectionKey): string {
  return SECTION_HOME[key];
}

export function canViewKycDocuments(role: OperatorRole | null | undefined): boolean {
  return canAccessSection(role, 'kyc');
}

export function canEditClientCredentials(
  role: OperatorRole | null | undefined,
  ctx: { isAssignedManager: boolean },
): boolean {
  if (role === 'admin') return true;
  return canAccessSection(role, 'clients') && ctx.isAssignedManager;
}
