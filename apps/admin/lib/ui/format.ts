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

export function fmtRelativeDay(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= startOfToday) return `сегодня ${time}`;
  if (d.getTime() >= startOfToday - 86_400_000) return `вчера ${time}`;
  return fmtDateTime(d);
}
