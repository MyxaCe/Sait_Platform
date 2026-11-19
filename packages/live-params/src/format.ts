import { intlTag } from '@broker/utils/locales';
import { WEEKDAYS, type LiveDayHours, type LiveSupportHours, type Weekday } from './snapshot';

const NBSP = ' ';

export function formatAmount(minor: number, currency: string, locale: string): string {
  const n = new Intl.NumberFormat(intlTag(locale), { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(minor / 100);
  return `${n}${NBSP}${currency}`;
}

export function formatBpsPercent(bps: number, locale: string): string {
  return new Intl.NumberFormat(intlTag(locale), { style: 'percent', maximumFractionDigits: 2 }).format(bps / 10_000);
}

export function formatLeverage(denominator: number): string {
  return `1:${denominator}`;
}

export function formatList(items: readonly string[], locale: string): string {
  return new Intl.ListFormat(intlTag(locale), { style: 'long', type: 'conjunction' }).format(items);
}

function weekdayName(day: Weekday, locale: string): string {
  const date = new Date(Date.UTC(2024, 0, 1 + WEEKDAYS.indexOf(day)));
  return new Intl.DateTimeFormat(intlTag(locale), { weekday: 'short', timeZone: 'UTC' }).format(date);
}

export interface LiveLabels {
  supportAlwaysOpen: string;
}

export function formatSupportHours(hours: LiveSupportHours, locale: string, labels: LiveLabels | null): string | null {
  if (hours.alwaysOpen) return labels?.supportAlwaysOpen?.trim() || null;
  const groups: { from: Weekday; to: Weekday; h: LiveDayHours }[] = [];
  for (const day of WEEKDAYS) {
    const h = hours.week[day];
    if (!h) continue;
    const last = groups[groups.length - 1];
    const prev = WEEKDAYS[WEEKDAYS.indexOf(day) - 1];
    if (last && prev === last.to && last.h.open === h.open && last.h.close === h.close) last.to = day;
    else groups.push({ from: day, to: day, h });
  }
  if (groups.length === 0) return null;
  const parts = groups.map((g) => {
    const days = g.from === g.to ? weekdayName(g.from, locale) : `${weekdayName(g.from, locale)}–${weekdayName(g.to, locale)}`;
    return `${days} ${g.h.open}–${g.h.close}`;
  });
  return `${parts.join(', ')} (${hours.timezone})`;
}
