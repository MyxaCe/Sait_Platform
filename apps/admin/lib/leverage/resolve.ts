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

/** Откуда взялось действующее плечо — для снимка, показа и аудита. */
export type LeverageSource = 'client-override' | 'class-override' | 'portfolio';

/** Портфель плеча: база + его class-override'ы (WEB-44/45). */
export interface PortfolioLeverage {
  readonly key: string;
  readonly title: string;
  /** Знаменатель 1:N базового плеча портфеля. */
  readonly baseLeverage: number;
  /**
   * Планка по классу инструмента ВНУТРИ портфеля (WEB-45): класс → знаменатель.
   * Единственное место, где класс ещё нужен (Р-446). Пусто — класс-override нет.
   */
  readonly classOverrides: Readonly<Record<string, number>>;
}

/**
 * Override клиента (WEB-46) — по заявке, с основанием. `null` поля override у
 * клиента означают «override нет», разрешение падает к классу/портфелю.
 */
export interface ClientLeverageOverride {
  /** Знаменатель 1:N, назначенный клиенту по заявке. */
  readonly leverage: number;
  readonly reason: string;
  readonly ticket: string;
}

/** Вход резолва: портфель клиента, его override (если есть), класс инструмента. */
export interface ResolveInput {
  readonly portfolio: PortfolioLeverage;
  /** Override клиента или `null`, если не выдан. */
  readonly clientOverride: ClientLeverageOverride | null;
  /**
   * Класс инструмента, для которого считаем плечо (`'crypto'`, `'fx'`, …), или
   * `null` — тогда class-override не рассматривается и действует база портфеля
   * (или override клиента, если он есть: override клиента классу не подчинён).
   */
  readonly instrumentClass: string | null;
}

/** Итог резолва — он же payload снимка плеча. */
export interface ResolvedLeverage {
  /** Действующий знаменатель 1:N. */
  readonly leverage: number;
  readonly source: LeverageSource;
  /** Класс, по которому сработал class-override; иначе `null`. */
  readonly instrumentClass: string | null;
  readonly portfolioKey: string;
}

/**
 * ЕДИНСТВЕННОЕ место, где решается, какое плечо действует. Приоритет Р-446:
 * override клиента перекрывает всё (он выдан адресно и по заявке); иначе —
 * class-override портфеля, если класс известен и планка по нему задана; иначе
 * — база портфеля.
 *
 * Override клиента НЕ подчинён классу сознательно (Р-446): он выдаётся
 * клиенту, а не классу; адресное решение оператора важнее планки класса.
 */
export function resolveLeverage(input: ResolveInput): ResolvedLeverage {
  const { portfolio, clientOverride, instrumentClass } = input;

  if (clientOverride) {
    return {
      leverage: clientOverride.leverage,
      source: 'client-override',
      instrumentClass: null,
      portfolioKey: portfolio.key,
    };
  }

  if (instrumentClass && Object.prototype.hasOwnProperty.call(portfolio.classOverrides, instrumentClass)) {
    return {
      leverage: portfolio.classOverrides[instrumentClass]!,
      source: 'class-override',
      instrumentClass,
      portfolioKey: portfolio.key,
    };
  }

  return {
    leverage: portfolio.baseLeverage,
    source: 'portfolio',
    instrumentClass: null,
    portfolioKey: portfolio.key,
  };
}

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
