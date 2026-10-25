import { staleSymbolsOf, type QuotesState } from '@broker/realtime';
import type { MdsQuotesOutcome } from '@/lib/mds';

/**
 * Символ → машинная причина, по которой у него нет цены (WEB-39).
 *
 * **Почему обычный объект, а не `Map`.** `InstrumentsBrowser` —
 * клиентский компонент, и проп пересекает границу сервер/клиент.
 * `Map` через неё не сериализуется: он приехал бы пустым, и страница
 * молчала бы ровно так же, как до задачи, — с зелёными проверками,
 * потому что в проверках границы нет.
 *
 * **Почему страница спрашивает, а лента нет.** Лента уже спрашивает
 * сама, из браузера (`TickerGate`). Страница инструментов —
 * `force-dynamic` и и так ходит за доступом, CMS и иконками: ещё один
 * серверный вопрос там дешевле нового клиентского пути и приезжает
 * сразу с разметкой, без второго кадра.
 */
export function unavailableReasonsOf(outcome: MdsQuotesOutcome): Record<string, string> {
  if (outcome.state !== 'available') {
    /*
      Не спросили — не знаем. Пустой объект здесь означает «причин
      назвать не можем», и страница покажет прежнее общее «нет
      данных». Подставить сюда причину самого отказа (`not-configured`,
      `http-error`) было бы подменой: это причина, по которой МЫ не
      смогли спросить, а не причина, по которой у инструмента нет
      цены. Разные вещи, и вторую мы в этом случае не знаем.
    */
    return {};
  }

  return reasonsFromState(outcome.quotes);
}

export function reasonsFromState(state: QuotesState): Record<string, string> {
  const out: Record<string, string> = {};

  for (const u of state.unavailable) {
    if (u.symbol.length === 0) continue;
    // `rawReason` сохраняется наравне: имя, которого нет в контракте,
    // всё равно причина, и показать её общим текстом честнее, чем
    // промолчать (WEB-26).
    out[u.symbol] = u.reason ?? u.rawReason ?? '';
  }

  for (const symbol of state.missing) {
    // «Источник не упомянул символ» — своя причина, не та же, что
    // «источник молчит по нему».
    if (symbol.length > 0 && out[symbol] === undefined) out[symbol] = 'missing';
  }

  return out;
}

/**
 * Проверка себя: список недоступных, собранный здесь, обязан совпадать
 * с тем, что считает общий `staleSymbolsOf`.
 *
 * Два независимых перечисления одного множества разошлись бы молча —
 * и страница показывала бы объяснение не у тех инструментов, у которых
 * погашена цена.
 */
export function agreesWithStaleSymbols(state: QuotesState): boolean {
  const mine = new Set(Object.keys(reasonsFromState(state)));
  const theirs = staleSymbolsOf(state);

  if (mine.size !== theirs.size) return false;
  for (const symbol of mine) if (!theirs.has(symbol)) return false;
  return true;
}
