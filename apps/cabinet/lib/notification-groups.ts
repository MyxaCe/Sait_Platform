/** Группы уведомлений для фильтра на странице «Уведомления». Тип без группы попадает в «Прочее». */
export const NOTIFICATION_GROUPS = ['trading', 'account', 'support'] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number] | 'other';

const BY_TYPE: Record<string, NotificationGroup> = {
  tradeExecuted: 'trading',
  marginCalled: 'trading',
  welcome: 'account',
  demoReset: 'account',
  accountTierUpgraded: 'account',
  documentUploaded: 'account',
  supportReply: 'support',
  supportResolved: 'support',
};

export function notificationGroup(type: string): NotificationGroup {
  return BY_TYPE[type] ?? 'other';
}

export function parseGroupFilter(value: string | undefined): NotificationGroup | 'all' {
  return value === 'trading' || value === 'account' || value === 'support' || value === 'other' ? value : 'all';
}

export function countByGroup(types: readonly string[]): Record<NotificationGroup, number> {
  const out: Record<NotificationGroup, number> = { trading: 0, account: 0, support: 0, other: 0 };
  for (const t of types) out[notificationGroup(t)] += 1;
  return out;
}
