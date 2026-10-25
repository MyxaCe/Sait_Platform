import { findSymbol } from '@broker/realtime';
import { describeSlippage } from './slippage';

/**
 * Подготовка параметров уведомления к показу (CAB-08).
 *
 * **Зачем отдельным модулем.** Страница уведомлений подставляет параметры
 * в шаблон вслепую, одинаково для любого типа. Решения «как показать цену» и
 * «что делать, когда параметров нет» внутри `.tsx` проверить нельзя, а
 * решения это настоящие: оба умеют показать человеку неправду.
 */

/** Параметры уведомления из базы: произвольный JSON, ничего не гарантировано. */
export type RawParams = Record<string, unknown>;

/**
 * Цена, отформатированная по точности ИНСТРУМЕНТА.
 *
 * Без этого цена уходит в обычное форматирование числа и теряет знаки:
 * `0.08143` показалось бы как `0,081`. Это не «короче», это **другое
 * число** — и ровно на месте суммы, по которой человек сверяет деньги.
 *
 * **Символ неизвестен — печатаем как есть, а не угадываем точность.** В
 * каталоге MDS инструментов больше, чем в нашем справочнике; выдуманные
 * знаки были бы тем же умолчанием, только в показе денег. Некрасиво
 * честнее неверного.
 */
export function formatPriceForSymbol(price: number, symbol: string, digits?: number): string {
  const d = digits ?? findSymbol(symbol)?.digits;
  return d === undefined ? String(price) : price.toFixed(d);
}

/** Сколько знаков после запятой несёт само число. */
function decimalsOf(value: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) return 0;
  const text = String(value);
  const dot = text.indexOf('.');
  if (dot < 0) return 0; // экспоненциальная запись — за точность не ручаемся
  return text.length - dot - 1;
}

/** Точность, при которой разница между ценами не исчезает. */
const MAX_PRICE_DIGITS = 8;

/**
 * Точность показа для ОДНОГО сообщения о сделке (WEB-41).
 *
 * **Что случилось на живом прогоне.** У BTCUSD в справочнике витрины
 * `digits: 0` — для бегущей строки целые доллары разумны. Стоп стоял в
 * трёх тиках, исполнение пришло на `80850.20` против уровня
 * `80859.97`, и сообщение округлило обе цены до целых: «по 80850»,
 * «уровня 80860», «на 10».
 *
 * При проскальзывании меньше полудоллара было бы хуже: сравнение в
 * `describeSlippage` идёт на той же точности, и разница схлопнулась бы
 * в `none` — **проскальзывание исчезло бы из сообщения целиком,
 * оставшись в данных**. Это не «утверждаем незнаемое», а **«знаем и не
 * говорим»**, причём молчание выглядит как ответ.
 *
 * **Правило WEB-20 при этом верное, неверен был источник точности.**
 * Называть разницу, которой не видно в самом сообщении, нельзя — но
 * точность сообщения выбираем мы. Поэтому она берётся из чисел,
 * которые в нём стоят: сколько знаков несут цена и уровень, столько и
 * показываем. Цена, уровень и величина разницы печатаются ОДНОЙ
 * точностью — иначе «по 80850.20 … на 10» противоречит само себе.
 *
 * Справочная точность остаётся нижней границей: она задаёт, сколько
 * знаков человек привык видеть, и опускаться ниже неё незачем.
 */
export function priceDigitsFor(symbol: string, values: number[]): number {
  const catalogue = findSymbol(symbol)?.digits ?? 2;
  const fromValues = Math.max(0, ...values.filter(isFiniteNumber).map(decimalsOf));
  return Math.min(Math.max(catalogue, fromValues), MAX_PRICE_DIGITS);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Параметры уведомления об исполненной сделке.
 *
 * `null` означает «показать этим шаблоном нечего»: страница тогда
 * показывает тип, а не предложение с незаполненными дырами.
 *
 * **Почему не `?? ''` и не пустой объект.** Шаблон
 * «Сделка исполнена: {side} {volume} {symbol} по {price}» при отсутствии
 * параметров выводит сами скобки — человек видит разметку вместо
 * сообщения. Пустая подстановка не лучше: «Сделка исполнена:  0.1  по »
 * выглядит как сообщение и читается как поломка данных у клиента, а не у
 * нас. Отсутствие обязательного параметра — это отказ показать ЭТОТ
 * шаблон, а не повод показать его наполовину.
 */
export function tradeExecutedParams(raw: RawParams): Record<string, string> | null {
  const { symbol, side, volume, price, level, acrossGap } = raw;

  if (!isNonEmptyString(symbol)) return null;
  if (side !== 'buy' && side !== 'sell') return null;
  if (!isFiniteNumber(volume)) return null;
  if (!isFiniteNumber(price)) return null;

  /*
   * Проскальзывание в уведомлении (WEB-20).
   *
   * Правило показа написано в `lib/slippage.ts` и впервые применилось в
   * истории сделок (CAB-09). Здесь оно доходит до уведомления — того
   * места, где человек узнаёт о закрытии ПЕРВЫМ.
   *
   * Уровня может не быть (рыночное закрытие, сделка старше поля) —
   * тогда вердикт `unknown`, и о проскальзывании мы молчим: сказать
   * «исполнено по уровню» было бы утверждением о том, чего не знаем.
   */
  /*
    Точность берётся из САМИХ чисел, а не из справочника витрины
    (WEB-41). У BTCUSD там `digits: 0`, и живое сообщение округлило
    `80850.20` и `80859.97` до целых, назвав разницу «10» вместо 9.77.
    При разнице меньше полудоллара она схлопнулась бы в `none` и
    исчезла бы из сообщения вовсе.
  */
  const digits = priceDigitsFor(symbol, [price, isFiniteNumber(level) ? level : Number.NaN]);
  const verdict = describeSlippage({
    execution: price,
    level: isFiniteNumber(level) ? level : null,
    side,
    digits,
  });

  return {
    symbol,
    side,
    volume: String(volume),
    // Одна точность на цену, уровень и разницу: «по 80850.20 … на 10»
    // противоречило бы само себе.
    price: formatPriceForSymbol(price, symbol, digits),
    level: isFiniteNumber(level) ? formatPriceForSymbol(level, symbol, digits) : '',
    slippage: verdict.kind === 'none' || verdict.kind === 'unknown'
      ? ''
      : formatPriceForSymbol(verdict.amount, symbol, digits),
    slippageKind: verdict.kind,
    /*
      Разрыв ТРЁХЗНАЧЕН, и здесь он был сведён к двум (WEB-40).

      Было `acrossGap === true ? 'yes' : 'no'`, и под `'no'` попадали
      два разных состояния: «фид не рвался» и «вопроса не возникает».
      У сделок, закрытых не триггером — вручную или неттингом, — ключа
      в событии нет вовсе, и это прибито тестом у терминала.
      Отсутствие не равно `false`.

      Видимых последствий пока нет: ни один шаблон этот параметр не
      читает. Но ловушка взведена — первая же ветвь `no {…}` сказала бы
      про ручное закрытие, что фид не рвался, хотя его никто не
      спрашивал.

      **И `false` не означает «проскальзывания не было».** Признак
      взводится, когда с последнего тика прошло больше тридцати секунд,
      то есть говорит о ДЫРЕ В ФИДЕ, а не о величине скачка цены.
      Разрыв цены при `false` — обычное проскальзывание внутри потока,
      и его мы как раз и называем. Вердикт считается из уровня и цены
      (`describeSlippage`) и этого признака не касается вовсе — ни
      здесь, ни в истории сделок.
    */
    acrossGap: acrossGap === true ? 'yes' : acrossGap === false ? 'no' : 'notApplicable',
  };
}

/**
 * Параметры для показа по типу уведомления.
 *
 * Типы, у которых нет своих правил, идут как есть: их шаблоны либо
 * обходятся без параметров, либо их параметры кладём мы сами и рядом.
 * Отдельная обработка заведена там, где значение **показывает деньги** —
 * там цена ошибки другая.
 */
export function displayParams(type: string, raw: RawParams): Record<string, unknown> | null {
  if (type === 'tradeExecuted') return tradeExecutedParams(raw);
  if (type === 'marginCalled') return marginCalledParams(raw);
  return raw;
}

/**
 * Параметры предупреждения о марже (маржин-колл).
 *
 * **Два уровня, и это не избыточность.** «Ваш уровень 97 %» ничего не
 * говорит человеку, который не помнит порог. Предупреждение, из которого
 * не видно, насколько всё плохо, — не предупреждение. Поэтому наружу
 * уходит и достигнутый уровень, и сколько осталось до закрытия.
 *
 * **Порога может не быть, и это НЕ ноль процентов.** Ноль означал бы
 * «закроют при нулевой марже» — конкретную и очень плохую новость.
 * Отсутствие означает, что принудительного закрытия нет вовсе. Разные
 * утверждения, и путать их нельзя (Р-118).
 *
 * Поэтому шаблонов два, и выбирает между ними вызывающий по полю
 * `hasStopOut`: подставить в один шаблон «—» вместо числа значило бы
 * оставить фразу «до закрытия осталось —», которая читается как
 * поломка, а не как «закрытия не будет».
 */
export interface MarginParams extends Record<string, string> {
  level: string;
  equity: string;
  usedMargin: string;
  /** Пусто, когда порога нет: шаблон без него выбирается отдельно. */
  stopOut: string;
  remaining: string;
  hasStopOut: 'yes' | 'no';
}

/** Центы → деньги. Та же величина, что у сделок: делим на сто. */
function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function marginCalledParams(raw: RawParams): MarginParams | null {
  const { marginLevelPct, stopOutLevelPct, equityCents, usedMarginCents } = raw;

  if (!isFiniteNumber(marginLevelPct)) return null;
  if (!isFiniteNumber(equityCents) || !isFiniteNumber(usedMarginCents)) return null;

  // `null` и отсутствие — одно и то же: порога нет. Ноль — это порог.
  const hasStopOut = isFiniteNumber(stopOutLevelPct);

  return {
    level: String(marginLevelPct),
    equity: money(equityCents),
    usedMargin: money(usedMarginCents),
    stopOut: hasStopOut ? String(stopOutLevelPct) : '',
    // Сколько осталось — величина, ради которой оба уровня и нужны.
    remaining: hasStopOut ? String(marginLevelPct - (stopOutLevelPct as number)) : '',
    hasStopOut: hasStopOut ? 'yes' : 'no',
  };
}

/**
 * Какой шаблон показать. Обычно он совпадает с типом, но у маржин-колла
 * их два: с порогом закрытия и без него.
 *
 * Выбор живёт здесь, рядом с решением о параметрах, а не в разметке:
 * внутри `.tsx` его нельзя было бы проверить без отрисовки, а решение
 * это содержательное — «закрытия не будет» и «до закрытия осталось
 * столько-то» говорят человеку противоположное.
 */
export function notificationKey(type: string, params: Record<string, unknown> | null): string {
  if (type === 'marginCalled' && params?.hasStopOut === 'no') return 'marginCalledNoStopOut';
  if (type === 'tradeExecuted') {
    // Проскальзывание против клиента ОБЪЯСНЯЕТСЯ, а не просто
    // называется: без второй половины фразы закрытие хуже уровня
    // читается как наша ошибка. Выигрыш клиента называется тоже —
    // у лимитного разрыв играет за него, и молчать об этом значило бы
    // приписать себе чужую удачу.
    if (params?.slippageKind === 'against') return 'tradeExecutedWorse';
    if (params?.slippageKind === 'favour') return 'tradeExecutedBetter';
  }
  return type;
}
