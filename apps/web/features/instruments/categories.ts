import type { InstrumentCategory } from '@broker/realtime';

export const CATEGORY_ORDER: InstrumentCategory[] = [
  'forex',
  'metals',
  'crypto',
  'indices',
  'stocks',
  'energy',
];

export const CATEGORY_LABELS_STATIC: Record<string, Record<InstrumentCategory, string>> = {
  ru: { forex: 'Forex', metals: 'Металлы', crypto: 'Криптовалюты', indices: 'Индексы', stocks: 'Акции', energy: 'Энергия' },
  en: { forex: 'Forex', metals: 'Metals', crypto: 'Crypto', indices: 'Indices', stocks: 'Stocks', energy: 'Energy' },
};
