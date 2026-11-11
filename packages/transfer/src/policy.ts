import type { GroupPlatform } from './registry';

/**
 * Допустимость направления «источник → цель» по профилям юрисдикций
 * (§2.4–2.5 проекта). Чистые функции — все комбинации проверяются тестами.
 *
 * Два уровня:
 *  - ЗАПРЕТ (blocker) — перевод провести нельзя: страна клиента запрещена в
 *    цели или цель её не обслуживает, цель не принимает переводы, у цели нет
 *    канала/ключа, цель = источник. Тот же расчёт делает и ЦЕЛЬ при приёме
 *    пакета (по своему профилю) — одна сторона не верит другой на слово;
 *  - ПОДСКАЗКА (hint) — решение не блокирует, но менеджер видит её в форме, а
 *    admin — в «Переводах клиентов» (список пишется в перевод и журнал).
 */

export const EU_EEA_COUNTRIES: ReadonlySet<string> = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU',
  'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  // ЕЭЗ
  'IS', 'LI', 'NO',
]);

export type DirectionBlocker =
  | 'targetUnknown'
  | 'targetIsSelf'
  | 'targetNotAccepting'
  | 'targetNoChannel'
  | 'countryForbidden'
  | 'countryNotServed'
  | 'countryUnknown';

export type DirectionHint =
  | 'euResidentNonEuTarget'
  | 'leverageHigher'
  | 'bonusesInTarget'
  | 'sourceKycNotVerified'
  | 'countryUnknownSoft';

export interface DirectionCheck {
  blockers: DirectionBlocker[];
  hints: DirectionHint[];
}

export function normalizeCountry(raw: string | null | undefined): string | null {
  const c = (raw ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

/**
 * Обслуживает ли профиль страну. `null` — страны нет: запрещено, только если
 * у профиля есть закрытый список обслуживаемых (иначе неизвестно, но не нарушено).
 */
export function countryVerdict(
  profile: Pick<GroupPlatform, 'servedCountries' | 'forbiddenCountries'>,
  country: string | null,
): 'ok' | 'forbidden' | 'notServed' | 'unknown' | 'unknownSoft' {
  if (!country) return profile.servedCountries.length ? 'unknown' : 'unknownSoft';
  if (profile.forbiddenCountries.includes(country)) return 'forbidden';
  if (profile.servedCountries.length && !profile.servedCountries.includes(country)) return 'notServed';
  return 'ok';
}

export function checkDirection(input: {
  selfSlug: string;
  source: GroupPlatform | null;
  target: GroupPlatform | null;
  clientCountry: string | null;
  sourceKycState?: string | null;
}): DirectionCheck {
  const blockers: DirectionBlocker[] = [];
  const hints: DirectionHint[] = [];
  const { target, source } = input;
  const country = normalizeCountry(input.clientCountry);
  if (!target) return { blockers: ['targetUnknown'], hints };
  if (target.slug === input.selfSlug) blockers.push('targetIsSelf');
  if (!target.acceptsTransfers) blockers.push('targetNotAccepting');
  if (!target.apiUrl || !target.publicKeyPem) blockers.push('targetNoChannel');
  const v = countryVerdict(target, country);
  if (v === 'forbidden') blockers.push('countryForbidden');
  if (v === 'notServed') blockers.push('countryNotServed');
  if (v === 'unknown') blockers.push('countryUnknown');
  if (v === 'unknownSoft') hints.push('countryUnknownSoft');

  if (country && EU_EEA_COUNTRIES.has(country) && !target.euLicense) hints.push('euResidentNonEuTarget');
  if (
    target.maxRetailLeverage !== null &&
    (source?.maxRetailLeverage == null || target.maxRetailLeverage > source.maxRetailLeverage)
  ) {
    hints.push('leverageHigher');
  }
  if (target.bonusesAllowed && !(source?.bonusesAllowed ?? false)) hints.push('bonusesInTarget');
  if (input.sourceKycState !== undefined && input.sourceKycState !== 'verified') hints.push('sourceKycNotVerified');
  return { blockers, hints };
}

/**
 * Проверка ЦЕЛИ при приёме пакета — по своему профилю. Возвращает код отказа
 * или `null` (принимаем).
 */
export function targetAcceptance(
  self: GroupPlatform | null,
  clientCountry: string | null,
): 'selfNotRegistered' | 'targetNotAccepting' | 'countryForbidden' | 'countryNotServed' | 'countryUnknown' | null {
  if (!self) return 'selfNotRegistered';
  if (!self.acceptsTransfers) return 'targetNotAccepting';
  const v = countryVerdict(self, normalizeCountry(clientCountry));
  if (v === 'forbidden') return 'countryForbidden';
  if (v === 'notServed') return 'countryNotServed';
  if (v === 'unknown') return 'countryUnknown';
  return null;
}

/**
 * Анти-массовость (§2.1(3), §2.4): менеджер не проводит больше N переводов за
 * сутки. Перевод — индивидуальное действие по заявлению клиента; поток
 * переводов от одного человека — признак предложения, а не инициативы.
 */
export const MANAGER_DAILY_TRANSFER_LIMIT = 5;

/**
 * Алерт отчёта (информационно): у менеджера за 30 дней больше
 * `ALERT_ABSOLUTE_30D` переводов или больше удвоенной медианы коллег (при ≥3).
 */
export const ALERT_ABSOLUTE_30D = 10;

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function managerAlert(count30d: number, allCounts: number[]): 'absolute' | 'aboveMedian' | null {
  if (count30d > ALERT_ABSOLUTE_30D) return 'absolute';
  const m = median(allCounts);
  if (count30d >= 3 && count30d > 2 * m) return 'aboveMedian';
  return null;
}

/**
 * Лёгкий линтер «предложения перевода» (§2.4): текст шаблона поддержки или
 * основания, упоминающий другую платформу группы (имя или домен кабинета).
 * Шаблоны поддержки с таким текстом не сохраняются (нет инструментов
 * предложения), основание перевода — допускается (это описание заявления).
 */
export function mentionsOtherPlatform(text: string, platforms: Pick<GroupPlatform, 'slug' | 'name' | 'cabinetUrl'>[], selfSlug: string): string | null {
  const lower = text.toLowerCase();
  for (const p of platforms) {
    if (p.slug === selfSlug) continue;
    let host = '';
    try {
      host = new URL(p.cabinetUrl).hostname.replace(/^cabinet\./, '');
    } catch {
      host = '';
    }
    if ((p.name && lower.includes(p.name.toLowerCase())) || (host && lower.includes(host.toLowerCase()))) return p.slug;
  }
  return null;
}
