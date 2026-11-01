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
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Дашборд', href: '/', icon: 'dashboard', roles: ['operator', 'admin'], exact: true },
  { key: 'clients', label: 'Клиенты', href: '/clients', icon: 'clients', roles: ['operator', 'admin'] },
  { key: 'kyc', label: 'Верификация', href: '/kyc', icon: 'kyc', roles: ['operator', 'admin'] },
  { key: 'money', label: 'Деньги', href: '/money', icon: 'money', roles: ['operator', 'admin'] },
  // Риск: operator видит, но действия — только просмотр (§3.8); запись гейтится
  // на самих страницах раздела. (Карта §2.2 помечает раздел 4 как скрытый для
  // operator — расхождение со §3.8; задача штаба явно оставляет скрытыми только
  // Операторов и break-glass, поэтому Риск виден обоим. Переключается одной
  // строкой: убрать 'operator' из roles.)
  { key: 'risk', label: 'Риск и плечо', href: '/risk', icon: 'risk', roles: ['operator', 'admin'] },
  { key: 'journal', label: 'Журнал', href: '/journal', icon: 'journal', roles: ['operator', 'admin'] },
  { key: 'operators', label: 'Операторы', href: '/operators', icon: 'operators', roles: ['admin'] },
  {
    key: 'break-glass',
    label: 'Break-glass',
    href: '/money/break-glass',
    icon: 'breakglass',
    roles: ['admin'],
    danger: true,
  },
];

/** Пункты, видимые роли. Fail-closed: роли нет в `roles` → пункта нет. */
export function navForRole(role: OperatorRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
