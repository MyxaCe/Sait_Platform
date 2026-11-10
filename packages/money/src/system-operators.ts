/**
 * Системные авторы журнала (миграция 1794600000000_crypto_money). Журнал
 * требует `operator_id`; переходы, которые делает не оператор, а клиент или
 * наблюдатель сети, пишутся от их имени. Войти ими нельзя (нет пароля,
 * учётка отключена).
 */
export const SYSTEM_OPERATORS = {
  cabinet: '00000000-0000-4000-8000-00000000c0b1',
  chainWatcher: '00000000-0000-4000-8000-00000000c0b2',
  promoEngine: '00000000-0000-4000-8000-00000000c0b3',
  /** Миграция 1795310000000_support (SUPPORT_SYSTEM_OPERATOR в @broker/support). */
  support: '00000000-0000-4000-8000-00000000c0b4',
} as const;

export const SYSTEM_OPERATOR_LOGINS = {
  cabinet: 'system:cabinet',
  chainWatcher: 'system:chain-watcher',
  promoEngine: 'system:promo-engine',
  support: 'system:support',
} as const;
