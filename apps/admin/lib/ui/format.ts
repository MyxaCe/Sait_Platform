/**
 * Форматы дат/времени центра управления (концепция §4.3). Один стиль на все
 * экраны: «09.11.2026, 21:43» (числовой, табличными цифрами — колонки ровные),
 * дата без времени — «09.11.2026», возраст — «2 дн 5 ч». Часовой пояс —
 * пояс сервера/браузера оператора; в журнале хранится UTC.
 */

const DT = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const D = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });

export function fmtDateTime(iso: string | Date): string {
  return DT.format(typeof iso === 'string' ? new Date(iso) : iso);
}

export function fmtDate(iso: string | Date): string {
  return D.format(typeof iso === 'string' ? new Date(iso) : iso);
}

/** Возраст: «<1 мин», «45 мин», «5 ч», «2 дн 5 ч». Только для показа. */
export function fmtAge(fromIso: string, now: Date = new Date()): string {
  const min = Math.floor((now.getTime() - new Date(fromIso).getTime()) / 60_000);
  if (min < 1) return '<1 мин';
  if (min < 60) return `${min} мин`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч`;
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem ? `${days} дн ${rem} ч` : `${days} дн`;
}

/** «сегодня 21:43» / «вчера 08:10» / «07.11.2026, 12:00» — для лент. */
export function fmtRelativeDay(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= startOfToday) return `сегодня ${time}`;
  if (d.getTime() >= startOfToday - 86_400_000) return `вчера ${time}`;
  return fmtDateTime(d);
}
