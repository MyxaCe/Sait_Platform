import type { OperatorRole } from '@/lib/auth/session';
import type { NavIconName } from './NavIcon';
import { SECTIONS, type SectionKey } from './sections';

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
  key: SectionKey;
  label: string;
  href: string;
  icon: NavIconName;
  /** Кто видит пункт — ИЗ МАТРИЦЫ `sections.ts` (тот же список гейтит доступ). */
  roles: readonly OperatorRole[];
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
  { key: 'dashboard', group: 'overview', label: 'Дашборд', href: '/', icon: 'dashboard', roles: SECTIONS.dashboard.roles, exact: true },
  { key: 'clients', group: 'compliance', label: 'Клиенты', href: '/clients', icon: 'clients', roles: SECTIONS.clients.roles },
  { key: 'kyc', group: 'compliance', label: 'Верификация', href: '/kyc', icon: 'kyc', roles: SECTIONS.kyc.roles },
  // AML-скрининг (ADM-14): отметка результата сверки по спискам; видят оба.
  { key: 'aml', group: 'compliance', label: 'AML-скрининг', href: '/aml', icon: 'aml', roles: SECTIONS.aml.roles },
  // ── Поддержка (ветка demo-support, 10.11) ──
  // Очередь обращений: все, кто работает с тикетами; finance_operator — только
  // назначенные ему (фильтр в запросах). support_operator — ТОЛЬКО этот раздел
  // (периметр роли — lib/auth/role-scope.ts).
  { key: 'support', group: 'compliance', label: 'Поддержка', href: '/support', icon: 'support', roles: SECTIONS.support.roles },
  // Риск: operator видит, но действия — только просмотр (§3.8); запись гейтится
  // на самих страницах раздела. href ведёт на реальную страницу раздела
  // (/risk-индекса нет; обе страницы — leverage/portfolios).
  { key: 'risk', group: 'money', label: 'Риск и плечо', href: '/risk/leverage', icon: 'risk', roles: SECTIONS.risk.roles },
  { key: 'journal', group: 'control', label: 'Журнал', href: '/journal', icon: 'journal', roles: SECTIONS.journal.roles },
  { key: 'operators', group: 'control', label: 'Операторы', href: '/operators', icon: 'operators', roles: SECTIONS.operators.roles },
  // «Деньги» (USDT TRC20, 09.11): депозиты/неопознанные/выводы — admin и
  // finance_operator, без второго аппрува (решение штаба). «Break-glass» по-прежнему
  // вне рельса — экранов нет.
  { key: 'money', group: 'money', label: 'Деньги', href: '/money', icon: 'money', roles: SECTIONS.money.roles },
  // «Акции и партнёры» (ДЕМО-акции, 10.11): видят admin и finance_operator (очередь
  // начислений — денежное решение); создание/изменение акций — только admin (гейт на страницах).
  { key: 'promo', group: 'money', label: 'Акции и партнёры', href: '/promo', icon: 'promo', roles: SECTIONS.promo.roles },
  { key: 'settings', group: 'control', label: 'Настройки платформы', href: '/settings', icon: 'settings', roles: SECTIONS.settings.roles },
];

/** Пункты, видимые роли. Fail-closed: роли нет в `roles` → пункта нет. */
export function navForRole(role: OperatorRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
