import type { MarketsData } from '@/lib/home';

/**
 * Какое объяснение показать вместо таблицы «Рынков» (Р-025, п. 3).
 *
 * Вынесено из компонента отдельным модулем сознательно: это чистая
 * функция и единственное место, где решается «какое состояние чем
 * объясняется». Внутри `.tsx` с `'use client'` её нельзя было бы
 * проверить без эмуляции браузера — а дорогая проверка, которую
 * перестали запускать, не защищает ни от чего.
 *
 * Текстов здесь нет, только ключи каталога (ADR-012).
 */
export type NoticeKey =
  | 'marketsClosedEmpty'
  | 'marketsClosedUnavailable'
  | 'marketsCatalog'
  | 'marketsNoMatch'
  | 'marketsNoTabs';

export interface Notice {
  titleKey: `${NoticeKey}Title`;
  textKey: `${NoticeKey}Text`;
  /** Машинный код причины — различает состояния на экране, не только в логе. */
  reason?: string;
}

/**
 * Что именно мешает показать таблицу. `null` — ничто не мешает.
 *
 * Порядок вердиктов — от сильного знания к слабому: граница доступа
 * сильнее каталога (закрытая граница делает состояние MDS неважным),
 * каталог сильнее конфигурации вкладок. Называть причиной то, что стоит
 * ниже по порядку, значит указать на исправную деталь.
 */
export function describeNotice(data: MarketsData, tabCount: number): Notice | null {
  switch (data.state) {
    case 'access-empty':
      return { titleKey: 'marketsClosedEmptyTitle', textKey: 'marketsClosedEmptyText' };
    case 'access-unavailable':
      return {
        titleKey: 'marketsClosedUnavailableTitle',
        textKey: 'marketsClosedUnavailableText',
        reason: data.reason,
      };
    case 'catalog-unavailable':
      return {
        titleKey: 'marketsCatalogTitle',
        textKey: 'marketsCatalogText',
        reason: data.reason,
      };
    case 'ok':
      // Доступ есть и каталог получен, но пересечение пусто: разрешённые
      // символы MDS не котирует. Это не «нет данных вообще» и не закрытая
      // граница — третья причина, и чинится она в CMS или в каталоге MDS.
      if (data.instruments.length === 0) {
        return { titleKey: 'marketsNoMatchTitle', textKey: 'marketsNoMatchText' };
      }
      // Редактор включил модуль и выключил все вкладки. Прежде это тоже
      // прятало модуль; конфигурационная ошибка обязана быть видна.
      if (tabCount === 0) {
        return { titleKey: 'marketsNoTabsTitle', textKey: 'marketsNoTabsText' };
      }
      return null;
  }
}
