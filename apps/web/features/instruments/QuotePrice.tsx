import { displayPrice, type Quote } from '@broker/realtime';
import { cn } from '@broker/ui';
import { formatPrice } from '@broker/utils';

/**
 * Цена инструмента — или прочерк, если настоящего чтения ещё не было
 * (WEB-17, класс B-018).
 *
 * **Что показывала страница инструмента до этого.** Стартовый снимок
 * справочника несёт `price: basePrice, ts: 0` — «инструмент такой
 * существует», а не «он стоит столько». Обе таблицы обзора и панель
 * инструмента печатали это число напрямую `formatPrice`, самой крупной
 * цифрой страницы. Изменение в процентах здесь починили ещё в B-018
 * (`?? 0` → `null`), а **саму цену — нет**: осталось уверенное число,
 * которого никто не котировал.
 *
 * Прочерк честнее не потому, что осторожнее, а потому, что цена
 * справочника — не старая цена этого инструмента. Это цифра из
 * описания, и показать её как котировку значит утверждать сделку,
 * которой не было.
 *
 * **Отдельный компонент, а не три вызова.** Мест три: две строки обзора
 * и панель. Три независимых вызова одного правила — три места, где его
 * забудут по отдельности.
 */
export function QuotePrice({
  quote,
  noDataLabel,
  className,
}: {
  /**
   * `undefined` — котировки нет вовсе (подписка ещё не принесла её).
   * Это то же незнание, что и снимок без настоящего чтения, и ответ у
   * них один. Принимать отсутствие здесь, а не подсовывать
   * компоненту выдуманный ноль ради типа, — часть того же правила.
   */
  quote: Pick<Quote, 'price' | 'digits' | 'ts'> | undefined;
  noDataLabel: string;
  className?: string;
}) {
  const price = quote ? displayPrice(quote, formatPrice) : null;

  if (price === null) {
    return (
      <span className={cn('text-secondary', className)} title={noDataLabel} aria-label={noDataLabel}>
        —
      </span>
    );
  }

  return <span className={className}>{price}</span>;
}

/**
 * Цена как ЧИСЛО — или `null`, если показывать её нельзя.
 *
 * Нужна там, где из цены что-то считают (спред) или на неё реагируют
 * (вспышка). Гейт тот же самый — `displayPrice`, а не повтор условия
 * `ts === 0`: второй источник одного правила разошёлся бы с первым
 * ровно тогда, когда порог приедет снаружи.
 */
export function priceReading(
  quote: Pick<Quote, 'price' | 'digits' | 'ts'> | undefined,
): number | null {
  if (!quote) return null;
  return displayPrice(quote, formatPrice) === null ? null : quote.price;
}
