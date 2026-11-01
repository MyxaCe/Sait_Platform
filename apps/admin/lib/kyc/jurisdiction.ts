/**
 * Профиль юрисдикции — место риск-порогов KYC (ADM-11, Р-454 I-2).
 *
 * **Решение: конфиг-модуль, а НЕ таблица `jurisdiction_profile`.** Ратификация
 * назвала «профиль юрисдикции» местом порогов, но не предрешила его форму.
 * Выбран конфиг в коде, потому что:
 *
 *  1. Ключа у таблицы пока нет. У клиента (`users`) нет измерения
 *     «юрисдикция», по которому строку профиля можно было бы выбрать. Таблица с
 *     единственной строкой под ключом-заглушкой — это церемония без данных:
 *     таблица, притворяющаяся, что в ней есть, чего в ней нет.
 *  2. Порог — это политика AML, а политику меняет РАТИФИКАЦИЯ (ADR / решение
 *     владельца), то есть рецензируемая правка кода, а не действие оператора в
 *     рантайме. Константа в коде держит ручку порога в том же гейте ревью, что
 *     и саму политику; строка в БД увела бы её из-под ревью.
 *  3. Рантайм-правка порога нам НЕ нужна и даже вредна: оператор, меняющий
 *     порог AML на лету, — это сам по себе риск. Таблица звала бы завести UI
 *     правки; константа запрещает это конструктивно (менять можно только
 *     миграцией кода под ревью).
 *  4. Меньше движущихся частей: ни миграции (таймстемп 1793795040000 остаётся
 *     незанятым — он был зарезервирован ТОЛЬКО на случай таблицы), ни новой
 *     поверхности schema-check, ни координации выката — ровно то «ограничь
 *     scope», что просила задача.
 *
 * Когда появится измерение юрисдикции у клиента и реальная потребность в разных
 * порогах по странам — профиль переедет в таблицу с настоящим ключом; граница
 * (этот тип + предикат) уже готова к такому переезду.
 */

export interface JurisdictionProfile {
  /** Ключ профиля. Пока один — `default` (измерения юрисдикции у клиента нет). */
  key: string;
  /**
   * Порог «источник средств» в USD. При достижении требуется документ
   * `source_of_funds`. Старт — $10 000 (Р-454 I-2).
   */
  sourceOfFundsThresholdUsd: number;
}

/** Профиль по умолчанию: единственный, пока юрисдикция у клиента не различается. */
export const DEFAULT_JURISDICTION_PROFILE: JurisdictionProfile = {
  key: 'default',
  sourceOfFundsThresholdUsd: 10_000,
};

/**
 * Факты о депозитах клиента, по которым считается, требуется ли `source_of_funds`.
 *
 * ВНЕ scope ADM-11: авто-подтягивание этих сумм. Денежная строка принадлежит
 * терминалу (Р-396), в операторке её может не быть; этот тип — контракт на
 * будущее подключение, а карточка сейчас работает в режиме «сумм нет» (см.
 * `sourceOfFundsStatus`).
 */
export interface DepositFacts {
  /** Максимальный ЕДИНИЧНЫЙ депозит, USD. */
  singleMaxUsd: number;
  /** Суммарные депозиты за последние 30 дней, USD. */
  rolling30dTotalUsd: number;
}

/**
 * Правило Р-454 I-2: `source_of_funds` требуется, если единичный депозит ≥ порога
 * ИЛИ суммарно за 30 дней ≥ порога. Чистый предикат — переиспользуется карточкой
 * и будущей привязкой сумм депозитов.
 */
export function sourceOfFundsRequiredByAmount(
  facts: DepositFacts,
  profile: JurisdictionProfile = DEFAULT_JURISDICTION_PROFILE,
): boolean {
  const threshold = profile.sourceOfFundsThresholdUsd;
  return facts.singleMaxUsd >= threshold || facts.rolling30dTotalUsd >= threshold;
}

/** Человекочитаемое правило порога — для подписи в карточке. */
export function sourceOfFundsRuleText(
  profile: JurisdictionProfile = DEFAULT_JURISDICTION_PROFILE,
): string {
  const usd = profile.sourceOfFundsThresholdUsd.toLocaleString('en-US');
  return `Документ «источник средств» требуется, если единичный депозит ≥ $${usd} или суммарно за 30 дней ≥ $${usd}.`;
}

/**
 * Статус «источника средств» для карточки.
 *
 *  - `submitted` — документ `source_of_funds` среди поданных есть.
 *  - `missing_amounts_unknown` — документа нет, а сумм депозитов в операторке
 *    нет (штатно, Р-396). Консервативный флаг: оператор проверяет вручную, бьёт
 *    ли клиент порог, и при необходимости запрашивает переподачу (ADM-10).
 *  - `missing_required` — документа нет И известные суммы уже бьют порог: точно
 *    требуется (путь задействуется, когда суммы подключат; сейчас недостижим).
 */
export type SourceOfFundsStatus =
  | 'submitted'
  | 'missing_amounts_unknown'
  | 'missing_required';

/**
 * Решает статус «источника средств» по наличию документа и (опционально) фактам
 * депозитов. Без фактов (режим «сумм нет») документ-отсутствие даёт
 * консервативный флаг `missing_amounts_unknown` — не «всё ок», а «проверь сам».
 */
export function sourceOfFundsStatus(
  hasSourceOfFundsDoc: boolean,
  deposits?: DepositFacts,
  profile: JurisdictionProfile = DEFAULT_JURISDICTION_PROFILE,
): SourceOfFundsStatus {
  if (hasSourceOfFundsDoc) return 'submitted';
  if (!deposits) return 'missing_amounts_unknown';
  return sourceOfFundsRequiredByAmount(deposits, profile)
    ? 'missing_required'
    : 'missing_amounts_unknown';
}
