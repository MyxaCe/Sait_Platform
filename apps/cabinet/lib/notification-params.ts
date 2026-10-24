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
export function formatPriceForSymbol(price: number, symbol: string): string {
  const digits = findSymbol(symbol)?.digits;
  return digits === undefined ? String(price) : price.toFixed(digits);
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
  const digits = findSymbol(symbol)?.digits ?? 2;
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
    price: formatPriceForSymbol(price, symbol),
    level: isFiniteNumber(level) ? formatPriceForSymbol(level, symbol) : '',
    slippage: verdict.kind === 'none' || verdict.kind === 'unknown'
      ? ''
      : formatPriceForSymbol(verdict.amount, symbol),
    slippageKind: verdict.kind,
    // Разрыв трёхзначен: называем его только когда источник сказал «был».
    acrossGap: acrossGap === true ? 'yes' : 'no',
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
