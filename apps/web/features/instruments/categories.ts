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

