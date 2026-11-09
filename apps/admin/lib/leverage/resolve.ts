/**
 * РЕЗОЛВ ПЛЕЧА — один закон на обе стороны (Р-446, WEB-44/45/46).
 *
 * Чистая функция, без базы и сети: «что задано → какое плечо действует». Тот
 * же порядок разрешения обязан применять и сайт-платформа (снимок в счёт,
 * предпросмотр в админке), и терминал (снимок в позицию на открытии,
 * TRM-49/50/53) — поэтому закон вынесен сюда один, а не переписан по разу на
 * каждой стороне (та же причина, по которой `@broker/tenant` держит границу
 * доступа в одном месте: два потребителя одного правила = риск их расхождения).
 *
 * Приоритет разрешения (Р-446, дословно):
 *   override клиента  ›  override класса в портфеле  ›  плечо портфеля
 *
 * Плечо везде — ЗНАМЕНАТЕЛЬ 1:N (целое ≥ 1): 1:20 → 20. Денежную модель это не
 * трогает (WEB-43 закрыт, Р-448); число лишь масштабирует требуемую маржу.
 */

/**
 * Сам закон живёт в `@broker/money` (`leverage.ts`): его применяет ещё и
 * кабинет (плечо в SSO-токене), и вторая копия означала бы риск
 * расхождения. Здесь — реэкспорт, чтобы вызывающие админки не менялись.
 */
export {
  resolveLeverage,
  type LeverageSource,
  type PortfolioLeverage,
  type ClientLeverageOverride,
  type ResolveInput,
  type ResolvedLeverage,
} from '@broker/money';
import type { PortfolioLeverage, ClientLeverageOverride } from '@broker/money';

/**
 * СНИМОК ПЛЕЧА В СЧЁТ (Р-446, WEB-44) — что сайт-платформа кладёт в счёт и
 * ПРЕДЛАГАЕТ отправлять терминалу (формат — предложение штабу, см. отчёт; сама
 * отправка — контракт со стороной терминала, не решается здесь).
 *
 * Снимок несёт НЕ одно число, а весь исходник разрешения: база портфеля, его
 * class-override'ы и override клиента. Так терминал на ОТКРЫТИИ позиции сам
 * резолвит плечо под класс конкретного инструмента тем же `resolveLeverage` и
 * кладёт итог снимком в позицию (позиция хранит снимок на момент открытия —
 * Р-446, сторона терминала). Одно число в снимке счёта потеряло бы
 * class-override (он per-class) — поэтому снимок везёт спецификацию целиком.
 */
export interface AccountLeverageSnapshot {
  readonly portfolioKey: string;
  readonly baseLeverage: number;
  readonly classOverrides: Readonly<Record<string, number>>;
  readonly clientOverride: number | null;
  /** Момент снятия снимка (ISO-8601). */
  readonly resolvedAt: string;
}

export function buildAccountLeverageSnapshot(
  portfolio: PortfolioLeverage,
  clientOverride: ClientLeverageOverride | null,
  resolvedAt: string = new Date().toISOString(),
): AccountLeverageSnapshot {
  return {
    portfolioKey: portfolio.key,
    baseLeverage: portfolio.baseLeverage,
    classOverrides: { ...portfolio.classOverrides },
    clientOverride: clientOverride ? clientOverride.leverage : null,
    resolvedAt,
  };
}

/** Человекочитаемое 1:N для показа (без локали — чистая строка). */
export function formatLeverage(denominator: number): string {
  return `1:${denominator}`;
}
