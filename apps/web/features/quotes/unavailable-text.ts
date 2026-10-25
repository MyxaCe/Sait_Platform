import { isSymbolUnavailableReason, type SymbolUnavailableReason } from '@broker/realtime';

/**
 * Почему у инструмента нет цены — словами, а не пустотой.
 *
 * **Довод владельца, и он не про косметику.** Витрина без цен на
 * семнадцати инструментах **выглядит сломанной, а не ограниченной**.
 * Человек должен отличать «мы этого пока не даём» от «у нас
 * сломалось», и отличать сам, не спрашивая.
 *
 * **Причина уже приезжает.** Ручка котировок отдаёт
 * `unavailable: [{ symbol, reason }]` машинным именем — мы её
 * разбирали, считали символ недоступным и **имя выбрасывали**. То
 * есть объяснение было у нас на руках и не показывалось.
 *
 * **Два семейства, потому что чинят их разные люди и ждут разного.**
 * `limited` — так устроено сегодня: источник не назначен, выключен,
 * инструмент не ведётся. Это обещание на будущее. `fault` — что-то не
 * работает или мы не можем судить: источник молчит, цена стара, реестр
 * не прочитан, порог не задан. Это извинение за сейчас.
 *
 * **Говорим наблюдение, а не диагноз.** «Источник молчит» — то, что мы
 * видим. «Рынок закрыт» — догадка, которой у нас нет оснований: MDS
 * сообщает молчание источника, а не состояние биржи. Подменить одно
 * другим значило бы снова утверждать незнаемое, только текстом.
 */

/** Чего ждать человеку: так устроено пока — или у нас неполадка. */
export type UnavailableFamily = 'limited' | 'fault';

export interface UnavailableExplanation {
  /** Ключ в словаре `instrumentUnavailable`. */
  key: string;
  family: UnavailableFamily;
}

const BY_REASON: Record<SymbolUnavailableReason, UnavailableExplanation> = {
  'source-disabled': { key: 'sourceDisabled', family: 'limited' },
  'no-source': { key: 'noSource', family: 'limited' },
  'not-in-catalog': { key: 'notInCatalog', family: 'limited' },
  'source-silent': { key: 'sourceSilent', family: 'fault' },
  stale: { key: 'stale', family: 'fault' },
  'registry-unreadable': { key: 'registryUnreadable', family: 'fault' },
  'threshold-unset': { key: 'thresholdUnset', family: 'fault' },
};

/**
 * Источник не сказал о символе ничего (`missing[]`).
 *
 * Отдельно от «источник молчит по символу»: там он символ знает и
 * цены не шлёт, здесь он символа не упомянул вовсе. Для человека это
 * одинаково «цены нет», для чинящего — разные места.
 */
export const MISSING: UnavailableExplanation = { key: 'notMentioned', family: 'fault' };

/**
 * Имя, которого в контракте нет (WEB-26). Не ошибка разбора: сосед мог
 * завести причину раньше, чем мы о ней узнали. Показываем общее — то
 * самое «по технической причине», — но относим к неполадке: о том, что
 * это ограничение, нам никто не говорил.
 */
export const UNKNOWN_REASON: UnavailableExplanation = { key: 'technical', family: 'fault' };

export function explainUnavailable(reason: string | null | undefined): UnavailableExplanation {
  if (reason === null || reason === undefined) return UNKNOWN_REASON;
  if (reason === 'missing') return MISSING;
  if (!isSymbolUnavailableReason(reason)) return UNKNOWN_REASON;
  return BY_REASON[reason];
}
