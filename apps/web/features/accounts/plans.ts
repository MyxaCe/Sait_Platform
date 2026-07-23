import type { AccountPlan } from '@broker/ui';

/**
 * Параметры счетов для калькулятора комиссий (общие для локалей).
 * spreadPips — средний спред по EURUSD; commissionPerLotRT — комиссия
 * за круг (открытие + закрытие) за 1 стандартный лот.
 */
export interface AccountPricing {
  id: string;
  name: string;
  spreadPips: number;
  commissionPerLotRT: number;
}

export const ACCOUNT_PRICING: AccountPricing[] = [
  { id: 'standard', name: 'Standard', spreadPips: 1.2, commissionPerLotRT: 0 },
  { id: 'pro', name: 'Pro', spreadPips: 0.5, commissionPerLotRT: 5 },
  { id: 'ecn', name: 'ECN Prime', spreadPips: 0.1, commissionPerLotRT: 6 },
];

const RU: AccountPlan[] = [
  {
    id: 'standard',
    name: 'Standard',
    description: 'Для первых шагов на рынке',
    minDeposit: '$100',
    ctaHref: '/register?account=standard',
    features: [
      { label: 'Спред от', value: '1.2 пункта' },
      { label: 'Комиссия', value: '$0' },
      { label: 'Кредитное плечо до', value: '1:500' },
      { label: 'Минимальный лот', value: '0.01' },
      { label: 'Инструменты', value: '12 000+' },
      { label: 'Исполнение', value: 'Market, от 14 мс' },
      { label: 'Своп-фри', value: 'Доступно' },
      { label: 'Персональный менеджер', value: '—' },
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'Для активных трейдеров',
    minDeposit: '$1 000',
    featured: true,
    ctaHref: '/register?account=pro',
    features: [
      { label: 'Спред от', value: '0.5 пункта' },
      { label: 'Комиссия', value: '$2.5 / лот / сторона' },
      { label: 'Кредитное плечо до', value: '1:400' },
      { label: 'Минимальный лот', value: '0.01' },
      { label: 'Инструменты', value: '12 000+' },
      { label: 'Исполнение', value: 'Market, от 14 мс' },
      { label: 'Своп-фри', value: 'Доступно' },
      { label: 'Персональный менеджер', value: 'Да' },
    ],
  },
  {
    id: 'ecn',
    name: 'ECN Prime',
    description: 'Межбанковская ликвидность',
    minDeposit: '$5 000',
    ctaHref: '/register?account=ecn',
    features: [
      { label: 'Спред от', value: '0.0 пунктов' },
      { label: 'Комиссия', value: '$3 / лот / сторона' },
      { label: 'Кредитное плечо до', value: '1:200' },
      { label: 'Минимальный лот', value: '0.01' },
      { label: 'Инструменты', value: '12 000+' },
      { label: 'Исполнение', value: 'ECN, от 9 мс' },
      { label: 'Своп-фри', value: 'По запросу' },
      { label: 'Персональный менеджер', value: 'Да' },
    ],
  },
];

const EN: AccountPlan[] = [
  {
    id: 'standard',
    name: 'Standard',
    description: 'For your first steps in the market',
    minDeposit: '$100',
    ctaHref: '/register?account=standard',
    features: [
      { label: 'Spread from', value: '1.2 pips' },
      { label: 'Commission', value: '$0' },
      { label: 'Leverage up to', value: '1:500' },
      { label: 'Minimum lot', value: '0.01' },
      { label: 'Instruments', value: '12,000+' },
      { label: 'Execution', value: 'Market, from 14 ms' },
      { label: 'Swap-free', value: 'Available' },
      { label: 'Personal manager', value: '—' },
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'For active traders',
    minDeposit: '$1,000',
    featured: true,
    ctaHref: '/register?account=pro',
    features: [
      { label: 'Spread from', value: '0.5 pips' },
      { label: 'Commission', value: '$2.5 / lot / side' },
      { label: 'Leverage up to', value: '1:400' },
      { label: 'Minimum lot', value: '0.01' },
      { label: 'Instruments', value: '12,000+' },
      { label: 'Execution', value: 'Market, from 14 ms' },
      { label: 'Swap-free', value: 'Available' },
      { label: 'Personal manager', value: 'Yes' },
    ],
  },
  {
    id: 'ecn',
    name: 'ECN Prime',
    description: 'Interbank liquidity',
    minDeposit: '$5,000',
    ctaHref: '/register?account=ecn',
    features: [
      { label: 'Spread from', value: '0.0 pips' },
      { label: 'Commission', value: '$3 / lot / side' },
      { label: 'Leverage up to', value: '1:200' },
      { label: 'Minimum lot', value: '0.01' },
      { label: 'Instruments', value: '12,000+' },
      { label: 'Execution', value: 'ECN, from 9 ms' },
      { label: 'Swap-free', value: 'On request' },
      { label: 'Personal manager', value: 'Yes' },
    ],
  },
];

export function getAccountPlans(locale: string): AccountPlan[] {
  return locale === 'en' ? EN : RU;
}

export const ACCOUNT_PLANS = RU;
