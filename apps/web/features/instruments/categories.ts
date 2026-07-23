import type { InstrumentCategory } from '@broker/realtime';

/** Порядок категорий в фильтрах; подписи — в messages, namespace `categories`. */
export const CATEGORY_ORDER: InstrumentCategory[] = [
  'forex',
  'metals',
  'crypto',
  'indices',
  'stocks',
  'energy',
];

/** Подписи категорий для серверного кода без next-intl контекста (JSON-LD и т.п.) */
export const CATEGORY_LABELS_STATIC: Record<string, Record<InstrumentCategory, string>> = {
  ru: { forex: 'Forex', metals: 'Металлы', crypto: 'Криптовалюты', indices: 'Индексы', stocks: 'Акции', energy: 'Энергия' },
  en: { forex: 'Forex', metals: 'Metals', crypto: 'Crypto', indices: 'Indices', stocks: 'Stocks', energy: 'Energy' },
};
