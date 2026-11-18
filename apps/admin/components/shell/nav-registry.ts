import type { OperatorRole } from '@/lib/auth/session';
import type { NavIconName } from './NavIcon';
import { SECTIONS, type SectionKey } from './sections';

export interface NavItem {
  key: SectionKey;
  label: string;
  href: string;
  icon: NavIconName;
  roles: readonly OperatorRole[];
  exact?: boolean;
  danger?: boolean;
  group: NavGroup;
}

export type NavGroup = 'overview' | 'compliance' | 'money' | 'control';
export const NAV_GROUPS: { key: NavGroup; label: string }[] = [
  { key: 'overview', label: 'Обзор' },
  { key: 'compliance', label: 'Клиенты и комплаенс' },
  { key: 'money', label: 'Деньги и риск' },
  { key: 'control', label: 'Контроль' },
];

export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', group: 'overview', label: 'Дашборд', href: '/', icon: 'dashboard', roles: SECTIONS.dashboard.roles, exact: true },
  { key: 'clients', group: 'compliance', label: 'Клиенты', href: '/clients', icon: 'clients', roles: SECTIONS.clients.roles },
  { key: 'kyc', group: 'compliance', label: 'Верификация', href: '/kyc', icon: 'kyc', roles: SECTIONS.kyc.roles },
  { key: 'aml', group: 'compliance', label: 'AML-скрининг', href: '/aml', icon: 'aml', roles: SECTIONS.aml.roles },
  { key: 'support', group: 'compliance', label: 'Поддержка', href: '/support', icon: 'support', roles: SECTIONS.support.roles },
  { key: 'risk', group: 'money', label: 'Риск и плечо', href: '/risk/leverage', icon: 'risk', roles: SECTIONS.risk.roles },
  { key: 'journal', group: 'control', label: 'Журнал', href: '/journal', icon: 'journal', roles: SECTIONS.journal.roles },
  { key: 'operators', group: 'control', label: 'Операторы', href: '/operators', icon: 'operators', roles: SECTIONS.operators.roles },
  { key: 'money', group: 'money', label: 'Деньги', href: '/money', icon: 'money', roles: SECTIONS.money.roles },
  { key: 'promo', group: 'money', label: 'Акции и партнёры', href: '/promo', icon: 'promo', roles: SECTIONS.promo.roles },
  { key: 'settings', group: 'control', label: 'Настройки платформы', href: '/settings', icon: 'settings', roles: SECTIONS.settings.roles },
];

export function navForRole(role: OperatorRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
