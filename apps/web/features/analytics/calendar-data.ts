/**
 * Мок экономического календаря (RU + EN). Даты генерируются относительно
 * текущего дня, чтобы календарь всегда выглядел актуальным. При подключении
 * реального провайдера заменяется на fetch — форма события сохранится.
 */

export type EventImportance = 1 | 2 | 3;

export interface EconomicEvent {
  id: string;
  datetime: string;
  currency: string;
  title: string;
  importance: EventImportance;
  previous: string | null;
  forecast: string | null;
  actual: string | null;
}

interface EventTemplate {
  dayOffset: number;
  hour: number;
  minute: number;
  currency: string;
  titleRu: string;
  titleEn: string;
  importance: EventImportance;
  previous: string | null;
  forecast: string | null;
  actual?: string | null;
}

const TEMPLATES: EventTemplate[] = [
  { dayOffset: -1, hour: 9, minute: 0, currency: 'EUR', titleRu: 'Индекс делового климата IFO (Германия)', titleEn: 'IFO Business Climate (Germany)', importance: 2, previous: '88.6', forecast: '89.0', actual: '89.4' },
  { dayOffset: -1, hour: 12, minute: 30, currency: 'USD', titleRu: 'Заказы на товары длительного пользования, м/м', titleEn: 'Durable Goods Orders, m/m', importance: 2, previous: '0.1%', forecast: '0.3%', actual: '−0.2%' },
  { dayOffset: -1, hour: 14, minute: 30, currency: 'USD', titleRu: 'Запасы сырой нефти EIA', titleEn: 'EIA Crude Oil Inventories', importance: 2, previous: '−4.9M', forecast: '−1.9M', actual: '−3.7M' },
  { dayOffset: 0, hour: 8, minute: 0, currency: 'GBP', titleRu: 'Индекс розничных продаж CBI', titleEn: 'CBI Retail Sales Index', importance: 1, previous: '−24', forecast: '−15', actual: '−11' },
  { dayOffset: 0, hour: 12, minute: 30, currency: 'USD', titleRu: 'ВВП США, кв/кв (предв.)', titleEn: 'US GDP, q/q (prelim.)', importance: 3, previous: '1.4%', forecast: '2.0%', actual: null },
  { dayOffset: 0, hour: 12, minute: 30, currency: 'USD', titleRu: 'Первичные заявки на пособие по безработице', titleEn: 'Initial Jobless Claims', importance: 2, previous: '243K', forecast: '238K', actual: null },
  { dayOffset: 0, hour: 23, minute: 30, currency: 'JPY', titleRu: 'Индекс потребительских цен Токио, г/г', titleEn: 'Tokyo CPI, y/y', importance: 2, previous: '2.3%', forecast: '2.2%', actual: null },
  { dayOffset: 1, hour: 6, minute: 0, currency: 'EUR', titleRu: 'Индекс потребительского доверия GfK (Германия)', titleEn: 'GfK Consumer Confidence (Germany)', importance: 1, previous: '−21.8', forecast: '−21.0' },
  { dayOffset: 1, hour: 12, minute: 30, currency: 'USD', titleRu: 'Базовый ценовой индекс PCE, м/м', titleEn: 'Core PCE Price Index, m/m', importance: 3, previous: '0.1%', forecast: '0.2%' },
  { dayOffset: 1, hour: 14, minute: 0, currency: 'USD', titleRu: 'Индекс настроений потребителей Мичигана (оконч.)', titleEn: 'Michigan Consumer Sentiment (final)', importance: 2, previous: '66.0', forecast: '66.4' },
  { dayOffset: 4, hour: 1, minute: 30, currency: 'CNY', titleRu: 'Индекс деловой активности PMI в производстве', titleEn: 'Manufacturing PMI', importance: 3, previous: '49.5', forecast: '49.8' },
  { dayOffset: 4, hour: 9, minute: 0, currency: 'EUR', titleRu: 'ВВП еврозоны, кв/кв (предв.)', titleEn: 'Eurozone GDP, q/q (prelim.)', importance: 3, previous: '0.3%', forecast: '0.2%' },
];

export function getCalendarEvents(now = new Date(), locale = 'ru'): EconomicEvent[] {
  return TEMPLATES.map((t, i) => {
    const date = new Date(now);
    date.setDate(date.getDate() + t.dayOffset);
    date.setHours(t.hour, t.minute, 0, 0);
    const isPast = date.getTime() < now.getTime();
    return {
      id: `evt-${i}`,
      datetime: date.toISOString(),
      currency: t.currency,
      title: locale === 'en' ? t.titleEn : t.titleRu,
      importance: t.importance,
      previous: t.previous,
      forecast: t.forecast,
      actual: isPast ? (t.actual ?? null) : null,
    };
  }).sort((a, b) => a.datetime.localeCompare(b.datetime));
}
