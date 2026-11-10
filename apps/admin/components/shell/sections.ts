import type { OperatorRole } from '@/lib/auth/session';

/**
 * МАТРИЦА ДОСТУПА «раздел → роли» — единственный источник правды и для рельса
 * (`nav-registry.ts` берёт отсюда `roles`), и для доступа (middleware, layout
 * каждого раздела, server actions). Пункт меню и право открыть адрес не могут
 * разойтись: это одна и та же строка.
 *
 * Fail-closed (Р-394):
 *  - путь раздела открыт только ролям раздела;
 *  - путь, не принадлежащий ни одному разделу и не общий (`COMMON_PATHS`),
 *    открыт только admin — новый экран, забытый здесь, закрыт для узких ролей,
 *    а не открыт всем «пока кто-нибудь не вспомнит».
 *
 * Edge-совместим (без node:* и БД): используется в middleware.
 *
 * Матрица (решение штаба 10.11, волна 3):
 *  - admin — всё;
 *  - operator — дашборд, клиенты, KYC, AML, журнал; риск — только просмотр
 *    (запись гейтится на страницах, §3.8); поддержка — вся очередь (§3.3
 *    дизайна поддержки);
 *  - finance_operator — дашборд, клиенты (карточка без KYC-документов), деньги,
 *    акции и партнёры, журнал; поддержка — только назначенные ему обращения
 *    (эскалация «в финансы», фильтр в SQL @broker/support);
 *  - support_operator — только поддержка.
 */
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
  /** Кто открывает раздел (и видит его пункт в рельсе). */
  roles: readonly OperatorRole[];
  /** Префиксы путей раздела: страницы и его `/api`. */
  paths: readonly string[];
  /** Только точное совпадение пути (корень `/`). */
  exact?: boolean;
}

export const ALL_ROLES: readonly OperatorRole[] = ['admin', 'operator', 'finance_operator', 'support_operator'];

/** Порядок — приоритет «домашней» страницы роли (первый доступный раздел). */
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

/** Открыто любому вошедшему оператору: включение 2FA, проверка живости. */
export const COMMON_PATHS: readonly string[] = ['/enroll', '/api/health'];

/** «Домашняя» страница раздела (куда ведёт пункт рельса и редирект отказа). */
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

/** Раздел, которому принадлежит путь; `null` — путь вне матрицы. */
export function sectionOfPath(pathname: string): SectionKey | null {
  for (const key of SECTION_KEYS) {
    const s = SECTIONS[key];
    if (s.paths.some((p) => under(pathname, p, s.exact))) return key;
  }
  return null;
}

/** Может ли роль открыть путь (страница или `/api`). Неизвестный путь — только admin. */
export function canAccessPath(role: OperatorRole, pathname: string): boolean {
  if (COMMON_PATHS.some((p) => under(pathname, p))) return true;
  const key = sectionOfPath(pathname);
  if (key === null) return role === 'admin';
  return canAccessSection(role, key);
}

/** Первая доступная роли страница — куда уводить при отказе. */
export function homeFor(role: OperatorRole): string {
  const key = SECTION_KEYS.find((k) => canAccessSection(role, k));
  // Роль без разделов (не должно случаться) — на вход 2FA, он вне матрицы и не зациклит.
  return key ? SECTION_HOME[key] : '/enroll';
}

export function sectionHome(key: SectionKey): string {
  return SECTION_HOME[key];
}

/**
 * KYC-документы (ссылки, presign) — те же роли, что раздел KYC. finance_operator
 * и support_operator документов не видят ни в карточке, ни по прямому вызову.
 */
export function canViewKycDocuments(role: OperatorRole | null | undefined): boolean {
  return canAccessSection(role, 'kyc');
}
