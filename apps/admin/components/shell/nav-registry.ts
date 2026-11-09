import type { OperatorRole } from '@/lib/auth/session';
import type { NavIconName } from './NavIcon';

/**
 * ЦЕНТРАЛЬНЫЙ реестр разделов операторской консоли (§2.2 дизайн-спеки).
 *
 * Единственный источник навигации: добавить/убрать раздел — одна строка здесь,
 * рельс подхватит. Роль-гейт — fail-closed (Р-394): недоступный роли пункт НЕ
 * рендерится (не «серый и кликабельный»), фильтрует `navForRole`.
 *
 * Порядок = карта §2.2. Пункты clients/money/risk/journal/operators ведут на
 * страницы, которые строят другие агенты, — в рельсе они уже присутствуют по
 * дизайну и «оживут», когда страницы появятся.
 */
export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: NavIconName;
  /** Кто видит пункт. Пусто роли нет в списке → пункта в рельсе нет. */
  roles: OperatorRole[];
  /** Активен только при точном совпадении пути (для корня `/`). */
  exact?: boolean;
  /** Аварийная дверь: красный акцент, визуально отделён (break-glass, Р-452). */
  danger?: boolean;
  /** Группа рельса (визуальная секция; на доступ не влияет). */
  group: NavGroup;
}

/** Секции рельса — порядок вывода. Пустая для роли секция не рисуется. */
export type NavGroup = 'overview' | 'compliance' | 'money' | 'control';
export const NAV_GROUPS: { key: NavGroup; label: string }[] = [
  { key: 'overview', label: 'Обзор' },
  { key: 'compliance', label: 'Клиенты и комплаенс' },
  { key: 'money', label: 'Деньги и риск' },
  { key: 'control', label: 'Контроль' },
];

export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', group: 'overview', label: 'Дашборд', href: '/', icon: 'dashboard', roles: ['operator', 'admin'], exact: true },
  { key: 'clients', group: 'compliance', label: 'Клиенты', href: '/clients', icon: 'clients', roles: ['operator', 'admin'] },
  { key: 'kyc', group: 'compliance', label: 'Верификация', href: '/kyc', icon: 'kyc', roles: ['operator', 'admin'] },
  // AML-скрининг (ADM-14): отметка результата сверки по спискам; видят оба.
  { key: 'aml', group: 'compliance', label: 'AML-скрининг', href: '/aml', icon: 'aml', roles: ['operator', 'admin'] },
  // Риск: operator видит, но действия — только просмотр (§3.8); запись гейтится
  // на самих страницах раздела. href ведёт на реальную страницу раздела
  // (/risk-индекса нет; обе страницы — leverage/portfolios).
  { key: 'risk', group: 'money', label: 'Риск и плечо', href: '/risk/leverage', icon: 'risk', roles: ['operator', 'admin'] },
  { key: 'journal', group: 'control', label: 'Журнал', href: '/journal', icon: 'journal', roles: ['operator', 'admin'] },
  { key: 'operators', group: 'control', label: 'Операторы', href: '/operators', icon: 'operators', roles: ['admin'] },
  // «Деньги» (USDT TRC20, 09.11): депозиты/неопознанные/выводы — admin и
  // finance_operator, без второго аппрува (решение штаба). «Break-glass» по-прежнему
  // вне рельса — экранов нет.
  { key: 'money', group: 'money', label: 'Деньги', href: '/money', icon: 'money', roles: ['admin', 'finance_operator'] },
  { key: 'settings', group: 'control', label: 'Настройки платформы', href: '/settings', icon: 'settings', roles: ['admin'] },
];

/** Пункты, видимые роли. Fail-closed: роли нет в `roles` → пункта нет. */
export function navForRole(role: OperatorRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
