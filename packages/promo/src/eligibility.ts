import type { PromotionStatus } from './rules';

/**
 * ДОСТУПНОСТЬ АКЦИИ клиенту = платформа ∧ акция ∧ страна (дизайн §3.9).
 *
 *  - платформа: «акции выключены» (профиль юрисдикции) и список стран, где
 *    акции не показываются;
 *  - акция: статус `active`, период, `countries_allow` / `countries_deny`;
 *  - страна клиента: `users.country` (из формы регистрации).
 *
 * Страна неизвестна (клиент зарегистрирован до сохранения страны): запреты
 * по «чёрному» списку её не задевают, а «белый» список акции — fail-closed
 * (раз акция объявлена только для некоторых стран, неизвестной её не даём).
 */

export interface PlatformPromoSettings {
  promotionsEnabled: boolean;
  attributionWindowDays: number;
  blockedCountries: string[];
}

export type Unavailability =
  | 'platform_disabled'
  | 'country_blocked'
  | 'country_not_allowed'
  | 'not_active'
  | 'not_started'
  | 'ended';

export interface PromoAvailabilityInput {
  settings: PlatformPromoSettings;
  promo: {
    status: PromotionStatus | string;
    startsAt: string | null;
    endsAt: string | null;
    countriesAllow: readonly string[];
    countriesDeny: readonly string[];
  };
  clientCountry: string | null;
  now: Date;
}

export function promoAvailability(
  input: PromoAvailabilityInput,
): { available: true } | { available: false; reason: Unavailability } {
  const { settings, promo, now } = input;
  const country = input.clientCountry?.trim().toUpperCase() || null;
  if (!settings.promotionsEnabled) return { available: false, reason: 'platform_disabled' };
  if (country && settings.blockedCountries.includes(country)) return { available: false, reason: 'country_blocked' };
  if (promo.status !== 'active') return { available: false, reason: 'not_active' };
  if (promo.startsAt && Date.parse(promo.startsAt) > now.getTime()) return { available: false, reason: 'not_started' };
  if (promo.endsAt && Date.parse(promo.endsAt) < now.getTime()) return { available: false, reason: 'ended' };
  if (country && promo.countriesDeny.includes(country)) return { available: false, reason: 'country_blocked' };
  if (promo.countriesAllow.length > 0 && (!country || !promo.countriesAllow.includes(country))) {
    return { available: false, reason: 'country_not_allowed' };
  }
  return { available: true };
}

/** Платформенный уровень (без конкретной акции): показывать ли раздел акций вообще. */
export function platformAllowsPromotions(
  settings: PlatformPromoSettings,
  clientCountry: string | null,
): { allowed: true } | { allowed: false; reason: 'platform_disabled' | 'country_blocked' } {
  if (!settings.promotionsEnabled) return { allowed: false, reason: 'platform_disabled' };
  const c = clientCountry?.trim().toUpperCase();
  if (c && settings.blockedCountries.includes(c)) return { allowed: false, reason: 'country_blocked' };
  return { allowed: true };
}
