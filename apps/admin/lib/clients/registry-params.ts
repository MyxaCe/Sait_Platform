import { AML_STATUSES, type AmlStatus } from '../aml/lists';
import { VERIFICATION_STATES, type VerificationState } from './verification-state';
import {
  managerFilterValue,
  parseManagerFilter,
  sameManagerFilter,
  type ManagerFilter,
} from '../managers/policy';

/**
 * Параметры реестра клиентов из URL (client-safe: без `pg`). Всё, что пришло
 * из адресной строки, приводится к закрытому множеству; неизвестное — к
 * значению по умолчанию (не к ошибке: ссылка со старым параметром не ломает
 * страницу).
 */

export const REGISTRY_PAGE_SIZE = 50;

export type RegistrySortKey = 'name' | 'registered' | 'activity' | 'balance';
export type AccessFilter = 'all' | 'active' | 'blocked' | 'restricted';

export const ACCESS_FILTERS: readonly AccessFilter[] = ['all', 'active', 'blocked', 'restricted'];

export interface RegistryQuery {
  q: string;
  kyc: VerificationState | 'all';
  aml: AmlStatus | 'all';
  access: AccessFilter;
  sort: RegistrySortKey;
  dir: 'asc' | 'desc';
  page: number;
  /** Фильтр по менеджеру (`?mgr=`): all | mine | none | id менеджера. */
  mgr: ManagerFilter;
  /**
   * Умолчание фильтра менеджера ДЛЯ ЭТОГО ЗРИТЕЛЯ: менеджеру — «мои», прочим —
   * «все». В URL пишется только отличие от умолчания.
   */
  mgrDefault: 'all' | 'mine';
}

export interface RegistryParseOptions {
  /** Зритель — менеджер клиентов: реестр по умолчанию открывается на «Мои клиенты». */
  defaultMine?: boolean;
}

const SORT_KEYS: readonly RegistrySortKey[] = ['name', 'registered', 'activity', 'balance'];

/** Старые значения `?sort=` (до фазы 2) — ссылки из закладок продолжают работать. */
const LEGACY_SORT: Record<string, [RegistrySortKey, 'asc' | 'desc']> = {
  registered_desc: ['registered', 'desc'],
  registered_asc: ['registered', 'asc'],
  name_asc: ['name', 'asc'],
  activity_desc: ['activity', 'desc'],
};

type Raw = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? '';
}

export function parseRegistryQuery(sp: Raw, opts: RegistryParseOptions = {}): RegistryQuery {
  const mgrDefault: 'all' | 'mine' = opts.defaultMine ? 'mine' : 'all';
  const kyc = one(sp.kyc ?? sp.state);
  const aml = one(sp.aml);
  const access = one(sp.access);
  const rawSort = one(sp.sort);
  const rawDir = one(sp.dir);

  let sort: RegistrySortKey = 'registered';
  let dir: 'asc' | 'desc' = 'desc';
  if (LEGACY_SORT[rawSort]) {
    [sort, dir] = LEGACY_SORT[rawSort];
  } else if ((SORT_KEYS as readonly string[]).includes(rawSort)) {
    sort = rawSort as RegistrySortKey;
    // Имя по умолчанию — по алфавиту, остальное — новые/большие сверху.
    dir = rawDir === 'asc' || rawDir === 'desc' ? rawDir : sort === 'name' ? 'asc' : 'desc';
  }

  const page = Number.parseInt(one(sp.page), 10);

  return {
    q: one(sp.q).slice(0, 200),
    kyc: (VERIFICATION_STATES as readonly string[]).includes(kyc) ? (kyc as VerificationState) : 'all',
    aml: (AML_STATUSES as readonly string[]).includes(aml) ? (aml as AmlStatus) : 'all',
    access: (ACCESS_FILTERS as readonly string[]).includes(access) ? (access as AccessFilter) : 'all',
    sort,
    dir,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    mgr: parseManagerFilter(one(sp.mgr), mgrDefault),
    mgrDefault,
  };
}

/** Есть ли активный фильтр (для пустого состояния «ничего не найдено» и «Сбросить»). */
export function hasRegistryFilter(q: RegistryQuery): boolean {
  return (
    q.q !== '' ||
    q.kyc !== 'all' ||
    q.aml !== 'all' ||
    q.access !== 'all' ||
    !sameManagerFilter(q.mgr, q.mgrDefault)
  );
}

/** URL реестра с подменой части параметров; значения по умолчанию в URL не пишем. */
export function registryHref(q: RegistryQuery, patch: Partial<RegistryQuery> = {}): string {
  const n = { ...q, ...patch };
  const p = new URLSearchParams();
  if (n.q) p.set('q', n.q);
  if (n.kyc !== 'all') p.set('kyc', n.kyc);
  if (n.aml !== 'all') p.set('aml', n.aml);
  if (n.access !== 'all') p.set('access', n.access);
  if (!sameManagerFilter(n.mgr, n.mgrDefault)) p.set('mgr', managerFilterValue(n.mgr));
  if (!(n.sort === 'registered' && n.dir === 'desc')) {
    p.set('sort', n.sort);
    p.set('dir', n.dir);
  }
  if (n.page > 1) p.set('page', String(n.page));
  const s = p.toString();
  return s ? `/clients?${s}` : '/clients';
}
