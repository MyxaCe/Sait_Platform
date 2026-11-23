import type { OnboardingPart } from '@broker/api-client';

/**
 * Якоря экскурсии кабинета: имя из CMS → CSS-селекторы.
 * Произвольный селектор в CMS ввести нельзя — только имя из этого списка
 * (список дублируется в CMS, поле «Элемент» шага). Селекторов несколько:
 * для компьютера и для телефона; берётся первый видимый на экране.
 */
export const CABINET_ANCHORS: Record<string, readonly string[]> = {
  'registration.firstName': ['#firstName'],
  'registration.lastName': ['#lastName'],
  'registration.email': ['#email'],
  'registration.phone': ['#phone'],
  'registration.country': ['#country'],
  'registration.password': ['#password'],
  'registration.submit': ['[data-tour="register-submit"]'],
  'cabinet.balanceDemo': ['[data-account="demo"]'],
  'cabinet.balanceReal': ['[data-account="real"]'],
  'cabinet.deposit': ['[data-money-button="deposit"]', '[data-tour="nav-wallet"]', '[data-tour="mnav-wallet"]'],
  'cabinet.withdraw': ['[data-money-button="withdraw"]', '[data-tour="nav-wallet"]', '[data-tour="mnav-wallet"]'],
  'cabinet.nextSteps': ['[data-tour="next-steps"]'],
  'cabinet.wallet': ['[data-tour="nav-wallet"]', '[data-tour="mnav-wallet"]'],
  'cabinet.history': ['[data-tour="nav-history"]', '[data-tour="mnav-history"]'],
  'cabinet.profile': ['[data-tour="nav-profile"]', '[data-tour="mnav-more"]'],
  'cabinet.security': ['[data-tour="nav-profile"]', '[data-tour="mnav-more"]'],
  'cabinet.trade': ['[data-tour="nav-trade"]', '[data-tour="mnav-trade"]'],
  'cabinet.help': ['[data-tour="help"]'],
};

export function anchorSelectors(anchor: string): readonly string[] {
  return CABINET_ANCHORS[anchor] ?? [];
}

/** Часть экскурсии, которой принадлежит якорь: `cabinet.deposit` → `cabinet`. */
export function anchorPart(anchor: string): OnboardingPart | null {
  const head = anchor.split('.')[0];
  return head === 'registration' || head === 'cabinet' || head === 'terminal' ? head : null;
}

/** Атрибут `data-tour` пункта меню: `/trade` → `nav-trade`. */
export function navTourId(href: string, mobile = false): string | undefined {
  const name = href === '/' ? 'home' : href.replace(/^\//, '').split('/')[0];
  if (!name) return undefined;
  return `${mobile ? 'mnav' : 'nav'}-${name}`;
}
