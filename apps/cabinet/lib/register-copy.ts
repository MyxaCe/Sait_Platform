import { formatCurrency } from '@broker/utils';
import type { TenantStartBalance } from '@/lib/tenant';

export type RegisterSubtitle =
  | { readonly key: 'registerSubtitleWithAmount'; readonly amount: string }
  | { readonly key: 'registerSubtitle' };

const ASSUMED_CURRENCY = 'USD';

export function registerSubtitle(
  startBalance: TenantStartBalance,
  locale: string,
): RegisterSubtitle {
  if (startBalance.state !== 'set') return { key: 'registerSubtitle' };

  return {
    key: 'registerSubtitleWithAmount',
    amount: formatCurrency(
      startBalance.cents / 100,
      ASSUMED_CURRENCY,
      locale === 'en' ? 'en-US' : 'ru-RU',
    ),
  };
}
