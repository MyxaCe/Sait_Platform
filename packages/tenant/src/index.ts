/**
 * `@broker/tenant` — граница доступа тенанта и конфиг, который её задаёт.
 *
 * Пакет создан решением штаба Р-029 (PKG-04). Отдельно от `api-client`
 * потому, что `api-client` — про транспорт и схемы ответов, а здесь
 * решение о доступе: отдельное имя делает видимым, что это граница.
 *
 * Потребителей два — витрина и кабинет, — значит по критерию PKG-01 это
 * контракт под надзором штаба: правка идёт через отчёт, а не молча.
 */

export {
  accessNotice,
  isAccessClosed,
  isSymbolAllowed,
  readAccess,
  UNAVAILABLE,
  type AccessNoticeSpec,
  type TenantAccess,
  type TenantAccessUnavailableReason,
} from './access';

export {
  readStartBalance,
  START_BALANCE_UNAVAILABLE,
  type TenantStartBalance,
  type TenantStartBalanceUnavailableReason,
} from './balance';

export {
  applyListExpiry,
  EDITORIAL_REUSE_WINDOW_SECONDS,
  readListExpiry,
  type ExpiryHeaders,
  type TenantListExpiry,
} from './expiry';

export {
  fetchTenantConfig,
  type TenantConfig,
  type TenantConfigRequest,
} from './config';
