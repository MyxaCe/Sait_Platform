'use client';

import { intlTag } from '@/lib/locale';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@broker/ui';

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
  allDay?: boolean;
}

function dayKey(event: EconomicEvent, timeZone: string): string {
  if (event.allDay) return event.datetime.slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(event.datetime));
}

function zoneLabel(timeZone: string, intlLocale: string): string {
  const offset = new Intl.DateTimeFormat(intlLocale, { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')?.value;
  return offset && timeZone !== 'UTC' ? `${timeZone}, ${offset}` : 'UTC';
}

export function EconomicCalendar({
  events,
  titleLang,
}: {
  events: EconomicEvent[];
  titleLang?: string;
}) {
  const t = useTranslations('analytics.calendar');
  const locale = useLocale();
  const intlLocale = intlTag(locale);
  const [minImportance, setMinImportance] = useState<EventImportance | 0>(0);
  const [timeZone, setTimeZone] = useState('UTC');

  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) setTimeZone(zone);
  }, []);

  const formatTime = (e: EconomicEvent) =>
    e.allDay
      ? t('allDay')
      : new Intl.DateTimeFormat(intlLocale, { timeZone, hour: '2-digit', minute: '2-digit' }).format(
          new Date(e.datetime),
        );

  const formatWeekday = (day: string) =>
    new Intl.DateTimeFormat(intlLocale, {
      timeZone: 'UTC',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date(`${day}T12:00:00Z`));

  const filters: { value: EventImportance | 0; label: string }[] = [
    { value: 0, label: t('filterAll') },
    { value: 3, label: t('filterHigh') },
    { value: 2, label: t('filterMedium') },
    { value: 1, label: t('filterLow') },
  ];

  const importanceLabel = (level: EventImportance) =>
    level === 3 ? t('importanceHigh') : level === 2 ? t('importanceMedium') : t('importanceLow');

  const groups = useMemo(() => {
    const filtered = events.filter(
      (e) => minImportance === 0 || e.importance === minImportance,
    );
    const byDay = new Map<string, EconomicEvent[]>();
    for (const event of filtered) {
      const day = dayKey(event, timeZone);
      const list = byDay.get(day) ?? [];
      list.push(event);
      byDay.set(day, list);
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [events, minImportance, timeZone]);

  function ImportanceDots({ level }: { level: EventImportance }) {
    const color =
      level === 3 ? 'bg-negative' : level === 2 ? 'bg-accent' : 'bg-secondary/50';
    const label = importanceLabel(level);
    return (
      <span role="img" aria-label={label} title={label} className="inline-flex gap-1">
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn('size-1.5 rounded-full', i <= level ? color : 'bg-border')}
          />
        ))}
      </span>
    );
  }

  return (
    <div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" style={{ scrollbarWidth: 'none' }}>
        {filters.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setMinImportance(f.value)}
            aria-pressed={minImportance === f.value}
            className={cn(
              'min-h-[40px] shrink-0 rounded-full border px-4 text-sm transition-colors',
              minImportance === f.value
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border bg-card text-secondary hover:text-primary',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <p className="mt-4 text-xs text-secondary" data-testid="calendar-timezone">
        {t('timeZoneNote', { zone: zoneLabel(timeZone, intlLocale) })}
      </p>

      <div className="mt-6 space-y-8">
        {groups.map(([day, dayEvents]) => (
          <section key={day} aria-label={formatWeekday(day)}>
            <h2 className="text-sm font-semibold capitalize text-primary">
              {formatWeekday(day)}
            </h2>

            <ul className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border md:hidden">
              {dayEvents.map((e) => (
                <li key={e.id} className="p-4">
                  <div className="flex items-center gap-3 text-xs text-secondary">
                    <span className="tabular-nums">{formatTime(e)}</span>
                    <span className="rounded bg-elevated px-1.5 py-0.5 font-medium text-primary">
                      {e.currency}
                    </span>
                    <ImportanceDots level={e.importance} />
                  </div>
                  <p lang={titleLang} className="mt-2 text-sm font-medium text-primary">
                    {e.title}
                  </p>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-secondary">{t('colPrevious')}</dt>
                      <dd className="mt-0.5 tabular-nums text-primary">{e.previous ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-secondary">{t('colForecast')}</dt>
                      <dd className="mt-0.5 tabular-nums text-primary">{e.forecast ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-secondary">{t('colActual')}</dt>
                      <dd className={cn('mt-0.5 tabular-nums', e.actual ? 'font-semibold text-accent' : 'text-secondary')}>
                        {e.actual ?? '—'}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>

            <div className="mt-3 hidden overflow-hidden rounded-2xl border border-border md:block">
              <table className="w-full text-sm">
                <thead className="bg-elevated text-left text-secondary">
                  <tr>
                    <th className="w-24 px-5 py-3 font-medium">{t('colTime')}</th>
                    <th className="w-20 px-5 py-3 font-medium">{t('colCurrency')}</th>
                    <th className="w-24 px-5 py-3 font-medium">{t('colImportance')}</th>
                    <th className="px-5 py-3 font-medium">{t('colEvent')}</th>
                    <th className="w-24 px-5 py-3 text-right font-medium">{t('colPrevious')}</th>
                    <th className="w-24 px-5 py-3 text-right font-medium">{t('colForecast')}</th>
                    <th className="w-24 px-5 py-3 text-right font-medium">{t('colActual')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {dayEvents.map((e) => (
                    <tr key={e.id} className="transition-colors hover:bg-elevated/50">
                      <td className="px-5 py-3.5 tabular-nums text-secondary">
                        {formatTime(e)}
                      </td>
                      <td className="px-5 py-3.5 font-medium text-primary">{e.currency}</td>
                      <td className="px-5 py-3.5">
                        <ImportanceDots level={e.importance} />
                      </td>
                      <td lang={titleLang} className="px-5 py-3.5 text-primary">
                        {e.title}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-secondary">
                        {e.previous ?? '—'}
                      </td>
                      <td className="px-5 py-3.5 text-right tabular-nums text-secondary">
                        {e.forecast ?? '—'}
                      </td>
                      <td
                        className={cn(
                          'px-5 py-3.5 text-right tabular-nums',
                          e.actual ? 'font-semibold text-accent' : 'text-secondary',
                        )}
                      >
                        {e.actual ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        {groups.length === 0 && (
          <p className="text-center text-secondary">{t('noEvents')}</p>
        )}
      </div>
    </div>
  );
}
