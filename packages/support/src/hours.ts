import { WEEKDAYS, type SupportSettings, type Weekday } from './settings';

/**
 * Рабочие часы и SLA в часах работы календаря тенанта (дизайн §3.2).
 * Часовой пояс — настройка (IANA), без библиотек: смещение пояса берётся у
 * `Intl` на каждый день отдельно (переход на летнее время учтён по дням).
 */

const MIN = 60_000;
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

interface LocalParts {
  y: number;
  m: number;
  d: number;
  minutes: number;
  weekday: Weekday;
  ymd: string;
}

const WD: Record<string, Weekday> = { Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun' };

export function localParts(at: Date, tz: string): LocalParts {
  const p: Record<string, string> = {};
  for (const part of fmt(tz).formatToParts(at)) p[part.type] = part.value;
  const y = Number(p.year);
  const m = Number(p.month);
  const d = Number(p.day);
  return {
    y,
    m,
    d,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    weekday: WD[p.weekday ?? 'Mon'] ?? 'mon',
    ymd: `${p.year}-${p.month}-${p.day}`,
  };
}

/** Смещение пояса в минутах (местное − UTC) в момент `at`. */
export function tzOffsetMinutes(at: Date, tz: string): number {
  const p: Record<string, string> = {};
  for (const part of fmt(tz).formatToParts(at)) p[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / MIN);
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Начало местных суток (UTC-момент) для даты y-m-d в поясе. */
function localMidnightUtc(y: number, m: number, d: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, 12); // полдень — далеко от переходов DST
  const off = tzOffsetMinutes(new Date(guess), tz);
  return Date.UTC(y, m - 1, d) - off * MIN;
}

function windowOf(s: SupportSettings, p: LocalParts): { open: number; close: number } | null {
  if (s.hours.holidays.includes(p.ymd)) return null;
  const h = s.hours.week[p.weekday];
  return h ? { open: toMin(h.open), close: toMin(h.close) } : null;
}

/** Сейчас рабочее время поддержки? */
export function isWithinHours(s: SupportSettings, at: Date): boolean {
  if (s.hours.alwaysOpen) return true;
  const p = localParts(at, s.hours.timezone);
  const w = windowOf(s, p);
  return w !== null && p.minutes >= w.open && p.minutes < w.close;
}

/**
 * Момент, когда истечёт `minutes` рабочих минут от `start`. Нерабочее время
 * (ночь, выходные, праздники) не тратит SLA. Предел — 120 дней вперёд: при
 * настройке «ни одного рабочего дня» (её не пропускает валидация) срок не
 * уходит в бесконечный цикл, а становится «через 120 дней».
 */
export function addBusinessMinutes(s: SupportSettings, start: Date, minutes: number): Date {
  if (s.hours.alwaysOpen) return new Date(start.getTime() + minutes * MIN);
  const tz = s.hours.timezone;
  let remaining = minutes;
  let cursor = start.getTime();
  for (let i = 0; i < 120; i++) {
    const p = localParts(new Date(cursor), tz);
    const dayStart = localMidnightUtc(p.y, p.m, p.d, tz);
    const w = windowOf(s, p);
    if (w) {
      const openAt = dayStart + w.open * MIN;
      const closeAt = dayStart + w.close * MIN;
      const from = Math.max(cursor, openAt);
      if (from < closeAt) {
        const avail = (closeAt - from) / MIN;
        if (avail >= remaining) return new Date(from + remaining * MIN);
        remaining -= avail;
      }
    }
    // Следующие местные сутки: +26 ч от полуночи гарантированно попадает в
    // следующий день при любом DST, затем выравниваемся на его полночь.
    const next = localParts(new Date(dayStart + 26 * 60 * MIN), tz);
    cursor = localMidnightUtc(next.y, next.m, next.d, tz);
  }
  return new Date(start.getTime() + 120 * 24 * 60 * MIN);
}

export function slaMinutesFor(s: SupportSettings, channel: 'chat' | 'email' | 'web_form'): number {
  return channel === 'chat'
    ? s.sla.chatFirstResponseMinutes
    : channel === 'email'
      ? s.sla.emailFirstResponseMinutes
      : s.sla.webFormFirstResponseMinutes;
}

export { WEEKDAYS };
