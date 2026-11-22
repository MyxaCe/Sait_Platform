export const SYSTEM_OPERATORS = {
  cabinet: '00000000-0000-4000-8000-00000000c0b1',
  chainWatcher: '00000000-0000-4000-8000-00000000c0b2',
  promoEngine: '00000000-0000-4000-8000-00000000c0b3',
  support: '00000000-0000-4000-8000-00000000c0b4',
} as const;

export const SYSTEM_OPERATOR_LOGINS = {
  cabinet: 'system:cabinet',
  chainWatcher: 'system:chain-watcher',
  promoEngine: 'system:promo-engine',
  support: 'system:support',
} as const;
