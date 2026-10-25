/**
 * Разбор закрытых сделок из ответа терминала `GET /deals/closed` (CAB-09).
 *
 * **Числа там целые, и это главное место ошибки.** Цены и уровень —
 * целые в единицах `price_decimals`, объём — в единицах `qty_decimals`,
 * а **`pnl` в центах и к точности цены отношения не имеет**. Применить
 * к нему `price_decimals` — значит показать прибыль в тысячи раз не той;
 * пропустить преобразование цены — показать цену в сто тысяч раз больше.
 * Ни то, ни другое не краснеет нигде: числа остаются числами, и обе
 * стороны зелены.
 *
 * Поэтому преобразование вынесено сюда и проверено отдельно, а не
 * размазано по месту показа.
 *
 * **Три состояния сохраняются.** `level` отсутствует, когда закрытие было
 * не по уровню либо сделка старше поля; `across_gap` трёхзначен — был
 * разрыв, не было, **неизвестно**. Пустое здесь означает «не знаем», а не
 * «нет»: `false` у старой сделки утверждал бы, что разрыва не было, то
 * есть отвечал бы за прошлое, которого мы не видели.
 */

export interface ClosedDeal {
  symbol: string;
  /**
   * Сторона ПОЗИЦИИ, как и на шине (§5, WEB-40).
   *
   * Здесь это следует из самой записи: у неё есть и вход, и выход,
   * то есть она описывает круговую сделку, а у круговой сторона может
   * быть только позиционной. Ручка и шина — разные контракты и могли
   * бы разойтись, но структура не оставляет второго прочтения.
   *
   * Названо явно, потому что ровно это прочтение я и перепутал на
   * шине: там подсказки в виде входа и выхода не было.
   */
  side: 'buy' | 'sell';
  /** Объём в обычных единицах. */
  volume: number;
  /** Цена входа. */
  entry: number;
  /** Цена ИСПОЛНЕНИЯ закрытия — по ней посчитаны деньги. */
  exit: number;
  /** Финансовый результат в центах, как и везде на платформе. */
  pnlCents: number;
  /** Уровень, который ставил человек. `null` — уровня у нас нет. */
  level: number | null;
  /** Разрыв ряда: `true`/`false`, `null` — неизвестно. */
  acrossGap: boolean | null;
  /** Знаков у цены — та точность, которую видит человек. */
  priceDigits: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Целое в единицах точности → обычное число. */
export function unscale(value: number, decimals: number): number {
  return value / 10 ** decimals;
}

/**
 * Одна сделка. `null` — запись непригодна; пропускаем её, а не
 * показываем наполовину.
 *
 * Мягко к ЛИШНИМ полям и строго к обязательным: терминал может добавить
 * своё, но сделка без цены закрытия — не сделка.
 */
export function parseClosedDeal(raw: unknown): ClosedDeal | null {
  if (!isObject(raw)) return null;

  const { symbol, side, qty, entry, exit, pnl, level, across_gap, price_decimals, qty_decimals } =
    raw;

  if (typeof symbol !== 'string' || symbol.length === 0) return null;
  if (side !== 'buy' && side !== 'sell') return null;
  if (!isInt(price_decimals) || !isInt(qty_decimals)) return null;
  if (!isInt(entry) || !isInt(exit) || !isInt(qty) || !isInt(pnl)) return null;

  return {
    symbol,
    side,
    volume: unscale(qty, qty_decimals),
    entry: unscale(entry, price_decimals),
    exit: unscale(exit, price_decimals),
    // Центы НЕ масштабируются точностью цены: это деньги, а не котировка.
    pnlCents: pnl,
    // Отсутствие уровня — законное состояние, а не брак записи.
    level: isInt(level) ? unscale(level, price_decimals) : null,
    acrossGap: typeof across_gap === 'boolean' ? across_gap : null,
    priceDigits: price_decimals,
  };
}

/** Список сделок: негодные записи выбрасываются, годные остаются. */
export function parseClosedDeals(body: unknown): ClosedDeal[] {
  if (!Array.isArray(body)) return [];
  return body
    .map(parseClosedDeal)
    .filter((deal): deal is ClosedDeal => deal !== null);
}
