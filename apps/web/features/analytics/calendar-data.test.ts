import { describe, expect, it } from 'vitest';
import { getCalendarEvents } from './calendar-data';

describe('getCalendarEvents', () => {
  const now = new Date('2026-07-23T10:00:00Z');
  const events = getCalendarEvents(now);

  it('события отсортированы по времени', () => {
    const times = events.map((e) => e.datetime);
    expect(times).toEqual([...times].sort());
  });

  it('«Факт» заполнен только у прошедших событий', () => {
    for (const event of events) {
      if (new Date(event.datetime).getTime() >= now.getTime()) {
        expect(event.actual).toBeNull();
      }
    }
    // хотя бы у одного прошедшего события факт есть
    const pastWithActual = events.filter(
      (e) => new Date(e.datetime).getTime() < now.getTime() && e.actual !== null,
    );
    expect(pastWithActual.length).toBeGreaterThan(0);
  });

  it('каждое событие имеет валюту и важность 1–3', () => {
    for (const event of events) {
      expect(event.currency).toMatch(/^[A-Z]{3}$/);
      expect([1, 2, 3]).toContain(event.importance);
    }
  });
});
