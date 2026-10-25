/**
 * Денежная величина из события шины: тройка или старое поле (шаг 2).
 *
 * **Зачем шаг посередине.** Терминал уже шлёт и старое `…Cents`, и
 * тройку `…Minor` + `currency` + `currencyMinorUnits`. Снять старое
 * поле он может только после того, как мы начнём читать новое, —
 * иначе разбор уронит события, уже лежащие в очереди, и вместе с
 * суммой потеряется **всё событие**.
 *
 * Поэтому здесь: тройка предпочитается, старое поле остаётся
 * запасным, и оба сверяются.
 *
 * **Почему «центы» не универсальны.** `currencyMinorUnits` — сколько
 * младших единиц в одной основной: у доллара два, у иены ноль, у
 * динара три. Зашитая сотня врёт на обоих концах этого ряда, и
 * «центы» — не имя величины, а допущение об одной валюте.
 */

/** Столько младших единиц в основной у валют, которые помещаются в «центы». */
const CENTS_MINOR_UNITS = 2;

/**
 * Старое и новое поле разошлись. Это не округление и не отставание:
 * одно и то же число названо дважды по-разному.
 */
export class MoneyDisagreementError extends Error {
  constructor(
    readonly field: string,
    readonly cents: number,
    readonly minor: number,
  ) {
    super(
      `${field}: старое поле ${cents} и новое ${minor} называют одну сумму по-разному. ` +
        'Пока валюта одна, они обязаны совпадать; расхождение означает, что одно из ' +
        'них посчитано не так, и выбрать правильное молча нельзя.',
    );
    this.name = 'MoneyDisagreementError';
  }
}

/**
 * Валюта с иным числом младших единиц, чем вмещает колонка в центах.
 *
 * Пока хранилище считает в центах, такую сумму записать **нечем**.
 * Делить или домножать здесь значило бы придумать точность, которой
 * у нас нет. Отказ громкий и названный; молчаливое округление
 * положило бы в счёт неверное число, и никто бы не узнал.
 */
export class UnrepresentableMoneyError extends Error {
  constructor(
    readonly field: string,
    readonly minorUnits: number,
    readonly currency: string | undefined,
  ) {
    super(
      `${field}: валюта ${currency ?? 'не названа'} имеет ${minorUnits} младших единиц, ` +
        'а хранилище считает в центах (2). Пересчёт здесь был бы выдуманной точностью.',
    );
    this.name = 'UnrepresentableMoneyError';
  }
}

export interface EventMoney {
  /** Сумма в младших единицах. */
  minor: number;
  /** Код валюты, если событие его назвало. */
  currency: string | null;
  /**
   * Младших единиц в основной, если событие их назвало.
   *
   * `null` — **не «два»**, а «событие не сказало». Разница в том, что
   * при двойке мы знаем точность, а при `null` лишь полагаемся на
   * старое соглашение. Шаг 3 уберёт второй случай.
   */
  minorUnits: number | null;
}

export interface EventMoneyInput {
  /** Как величина называется — для текста отказа. */
  field: string;
  /** Старое поле. `undefined` — событие его уже не шлёт. */
  cents: number | undefined;
  /** Новое поле тройки. */
  minor: number | undefined;
  currency: string | undefined;
  currencyMinorUnits: number | undefined;
}

/**
 * Разрешает сумму из события.
 *
 * `null` — величины в событии нет вовсе (например, у сделки без
 * реализованного результата). Это не ноль: ноль означал бы «ничего не
 * заработано», а здесь нечего и называть.
 */
export function moneyFromEvent({
  field,
  cents,
  minor,
  currency,
  currencyMinorUnits,
}: EventMoneyInput): EventMoney | null {
  if (minor === undefined) {
    // Тройки нет — старое поле, старое соглашение.
    if (cents === undefined) return null;
    return { minor: cents, currency: currency ?? null, minorUnits: null };
  }

  /*
    Сторож совпадения, перенятый у терминала. Пока валюта одна, старое
    и новое поле обязаны называть одно число. Ловушку «числа совпадают,
    значит шаги лишние» он превращает в проверку: совпадение становится
    утверждением, которое можно нарушить и увидеть это.

    Сверяется ТОЛЬКО при двух младших единицах: при ином их числе
    старое поле не способно выразить сумму, и расхождение означало бы
    не ошибку, а разную точность.
  */
  const units = currencyMinorUnits ?? null;
  if (cents !== undefined && (units === null || units === CENTS_MINOR_UNITS) && cents !== minor) {
    throw new MoneyDisagreementError(field, cents, minor);
  }

  if (units !== null && units !== CENTS_MINOR_UNITS) {
    throw new UnrepresentableMoneyError(field, units, currency);
  }

  return { minor, currency: currency ?? null, minorUnits: units };
}
