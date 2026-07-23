/** Форматирование денежных сумм: formatCurrency(1234.5, 'USD') → "$1,234.50" */
export function formatCurrency(value: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Компактные числа: formatCompact(87_000_000_000) → "87 млрд" */
export function formatCompact(value: number, locale = 'ru-RU'): string {
  return new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/** Цена инструмента с нужной точностью: forex — 5 знаков, крипта — динамически */
export function formatPrice(value: number, digits = 5): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Процентное изменение со знаком: +1.24% / −0.87% */
export function formatChangePercent(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

/** Дата: 23 июля 2026 */
export function formatDate(iso: string | Date, locale = 'ru-RU'): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

/** Время: 14:30 */
export function formatTime(iso: string | Date, locale = 'ru-RU'): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** День недели + дата: среда, 23 июля */
export function formatWeekday(iso: string | Date, locale = 'ru-RU'): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(iso));
}
