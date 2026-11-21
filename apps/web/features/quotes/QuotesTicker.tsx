'use client';

import { useTranslations } from 'next-intl';
import { displayPrice, useConnectionStatus, useQuoteViews, type QuoteMarket } from '@broker/realtime';
import { TickerTape } from '@broker/ui';
import { formatPrice } from '@broker/utils';
import { useMarketText } from './market-text';
import { explainUnavailable, shortKeyOf } from './unavailable-text';

/**
 * Контейнер бегущей строки: подписывается на живой фид
 * (мок или socket.io — решает NEXT_PUBLIC_WS_URL) и маппит
 * котировки в презентационный TickerTape из дизайн-системы.
 *
 * `symbols` ОБЯЗАТЕЛЕН и умолчания не имеет (WEB-08, Р-050). Здесь стоял
 * `= DEFAULT_TICKER_SYMBOLS`, и это была вторая дверь к тому же дефекту:
 * `<QuotesTicker />` без пропа рисовал зашитый список как живые
 * котировки. Решение, какие символы показывать, принимает `decideTicker`
 * по рантайм-ответам; компонент его не угадывает.
 */
export function QuotesTicker({
  symbols,
  staleSymbols,
  unavailableReasons,
  markets,
}: {
  symbols: string[];
  /**
   * Символы, которые ИСТОЧНИК объявил недоступными: `unavailable[]` плюс
   * `missing[]` ответа `/v1/quotes` (WEB-12). Приезжает готовым
   * множеством от островка — сам компонент в сеть не ходит.
   */
  staleSymbols?: ReadonlySet<string>;
  /**
   * Символ → машинная причина, которую назвал ИСТОЧНИК (WEB-38).
   *
   * Раньше сюда доезжало только множество символов: причина
   * разбиралась и выбрасывалась, и молчащий инструмент не мог сказать,
   * почему молчит. Ключи этой карты и есть `staleSymbols` — список
   * выводится из неё, чтобы два списка не разошлись.
   */
  unavailableReasons?: ReadonlyMap<string, string | null>;
  markets?: ReadonlyMap<string, QuoteMarket>;
}) {
  const tConn = useTranslations('connection');
  const tWhy = useTranslations('instrumentUnavailable');
  // Порог свежести придёт от MDS (КОНТРАКТЫ.md §5б) — здесь не выдумываем
  const views = useQuoteViews(symbols, { staleSymbols, markets });
  const marketText = useMarketText();
  const status = useConnectionStatus();

  const items = views.map(({ quote: q, state }) => {
    const reason = unavailableReasons?.get(q.symbol);
    const why = reason === undefined ? null : explainUnavailable(reason);
    const market = marketText(q.market ?? markets?.get(q.symbol));
    return {
      symbol: q.symbol,
      // Правило «настоящего чтения ещё не было» — общее для витрины и
      // кабинета, поэтому живёт в пакете, а не повторяется здесь (PKG-06).
      price: displayPrice(q, formatPrice),
      changePercent: q.changePercent,
      href: `/instruments/${q.category}/${q.symbol.toLowerCase()}`,
      state,
      // Подписи ставятся ТОЛЬКО когда источник назвал причину. Иначе
      // `undefined`, и лента показывает прежнее общее «нет данных»:
      // объяснение, появившееся там, где объяснять нечего, было бы
      // таким же утверждением о незнаемом, как подставленное число.
      unavailableLabel: why ? tWhy(why.key) : undefined,
      unavailableShort: market ?? (why ? tWhy(shortKeyOf(why)) : undefined),
      marketLabel: market ?? undefined,
    };
  });

  return (
    <TickerTape
      items={items}
      status={status}
      ariaLabel={tConn('tickerAria')}
      connectionLabel={tConn(status)}
      noDataLabel={tConn('noData')}
      lastKnownLabel={tConn('lastKnown')}
    />
  );
}
