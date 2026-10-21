import { findSymbol } from '@broker/realtime';

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
  const { symbol, side, volume, price } = raw;

  if (!isNonEmptyString(symbol)) return null;
  if (side !== 'buy' && side !== 'sell') return null;
  if (!isFiniteNumber(volume)) return null;
  if (!isFiniteNumber(price)) return null;

  return {
    symbol,
    side,
    volume: String(volume),
    price: formatPriceForSymbol(price, symbol),
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
  return type === 'tradeExecuted' ? tradeExecutedParams(raw) : raw;
}
