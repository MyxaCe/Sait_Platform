import type { CabinetHomeModule } from '@broker/api-client';
import type { CSSProperties } from 'react';

export type HomeSlot = CabinetHomeModule['type'] | 'recent' | 'referral';

/**
 * Порядок блоков главной на телефоне — как в CMS (ТД-009 п.6). На компьютере остаётся
 * утверждённая владельцем сетка 24.11 (места блоков фиксированы), CMS там только включает
 * и выключает блоки. «Последние операции» и «Пригласи друга» — не модули CMS: идут сразу
 * за рынками и за счетами соответственно.
 */
export function homeSlotOrder(modules: readonly CabinetHomeModule[]): Record<HomeSlot, number> {
  const enabled = modules.filter((m) => m.enabled).map((m) => m.type);
  const base = (type: CabinetHomeModule['type'], fallback: number) => {
    const i = enabled.indexOf(type);
    return (i < 0 ? fallback : i) * 10;
  };
  const balance = base('balance', 2);
  const markets = base('markets', 3);
  return {
    profile: base('profile', 0),
    onboarding: base('onboarding', 1),
    balance,
    referral: balance + 5,
    markets,
    recent: markets + 5,
    promotions: base('promotions', 4),
  };
}

/** Класс + переменная для CSS order: на телефоне — порядок CMS, с xl — места сетки. */
export const ORDER_CLASS = '[order:var(--home-order)] xl:[order:0]';
export const orderStyle = (n: number) => ({ '--home-order': String(n) }) as CSSProperties;
